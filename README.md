# Taller-Servicio-Solana-PDA

Programa de Anchor adaptado del template `WayLearnLatam/Registro-Ventas-Solana-PDA` para gestionar un **Taller de Servicio Técnico** en Solana mediante PDAs jerárquicas de tres niveles (`Taller` → `Equipo` → `Orden`).

El archivo `src/lib.rs` conserva la estructura nativa de **Solana Playground** (`declare_id!("")`, sin `Cargo.toml` ni `Anchor.toml`) y está preparado para compilarse, desplegarse en Devnet y exportar su `idl.json` directamente desde Solana Playground.

---

## 1. Descripción del caso de uso y árbol de PDAs

El programa modela el flujo operativo de un taller de servicio técnico donde un dueño (`owner`) administra su taller, registra equipos de clientes con un identificador numérico automático y gestiona órdenes de reparación identificadas por un código alfanumérico:

```text
Taller  <- [b"taller", nombre_taller, owner]      raíz (owner = autoridad)
 └─ Equipo <- [b"equipo", taller, id_equipo]      id automático (id_counter + 1 en Taller)
     └─ Orden  <- [b"orden", equipo, codigo]      identificada por texto (codigo)
```

Cada cuenta hija incluye la clave pública de su cuenta padre en las semillas PDA, por lo que la pertenencia queda garantizada por construcción y la autorización se valida desde la raíz con `has_one = owner @ Errores::NoOwner`. Los vectores `equipos` y `ordenes` almacenan únicamente `Pubkey` (32 bytes por referencia) como índice de lectura para el frontend.

---

## 2. Mapa completo de cuentas, cálculo Borsh, semillas y límites

### Resumen de cuentas y cálculo de bytes Borsh (`INIT_SPACE + 8`)

En Anchor, el discriminador de cuenta ocupa **8 bytes**, cada `String` usa **4 bytes** de prefijo de longitud + `max_len` bytes, y cada `Vec<Pubkey>` usa **4 bytes** de prefijo de longitud + `max_len * 32` bytes.

#### Cuenta `Taller` (raíz) — **400 bytes totales** (`INIT_SPACE = 392` + `8`)

| Campo | Tipo | `#[max_len]` | Cálculo Borsh (bytes) | Origen |
|---|---|---|---|---|
| `owner` | `Pubkey` (`pub`) | — | `32` | Patrón (`has_one = owner`) |
| `nombre_taller` | `String` | `30` (`<= 32` por ser semilla, `<= 50`) | `4 + 30 = 34` | Caso de uso |
| `equipos` | `Vec<Pubkey>` | `10` | `4 + (10 * 32) = 324` | Patrón (índice de PDAs) |
| `id_counter` | `u16` | — | `2` | Patrón (auto-ID de `Equipo`) |
| **Discriminador Anchor** | — | — | `8` | Anchor |
| **Total asignado (`space`)** | | | **`400` bytes** | `Taller::INIT_SPACE + 8` |

- **Semillas PDA exactas:** `[b"taller", nombre_taller.as_bytes(), owner.key().as_ref()]`
  - `b"taller"`: 6 bytes
  - `nombre_taller.as_bytes()`: máx. 30 bytes UTF-8 (`<= 32` bytes permitidos por Solana)
  - `owner.key().as_ref()`: 32 bytes
- **Límites y unicidad:**
  - Máximo **10** elementos en `equipos: Vec<Pubkey>` (validado en runtime con `require!(..., Errores::LimiteAlcanzado)`).
  - `id_counter: u16` soporta hasta **`65_535`** equipos registrados; es estrictamente incremental y nunca disminuye ni se reutiliza.
  - Unicidad por `(nombre_taller, owner)`: un mismo `owner` no puede crear dos talleres con el mismo `nombre_taller`.

#### Cuenta `Equipo` (entidad intermedia) — **370 bytes totales** (`INIT_SPACE = 362` + `8`)

| Campo | Tipo | `#[max_len]` | Cálculo Borsh (bytes) | Origen |
|---|---|---|---|---|
| `id_equipo` | `u16` | — | `2` | Patrón (auto-ID) |
| `modelo` | `String` | `30` (`<= 50`) | `4 + 30 = 34` | Caso de uso |
| `ordenes_activas` | `u16` | — | `2` | Patrón (contador de órdenes) |
| `ordenes` | `Vec<Pubkey>` | `10` | `4 + (10 * 32) = 324` | Patrón (índice de PDAs) |
| **Discriminador Anchor** | — | — | `8` | Anchor |
| **Total asignado (`space`)** | | | **`370` bytes** | `Equipo::INIT_SPACE + 8` |

- **Semillas PDA exactas:**
  - En `init` (`registrar_equipo`): `[b"equipo", taller.key().as_ref(), (taller.id_counter + 1).to_le_bytes().as_ref()]`
  - En lookup (`crear_orden`, `cambiar_costo`, `cerrar_orden`): `[b"equipo", taller.key().as_ref(), id_equipo.to_le_bytes().as_ref()]`
  - `b"equipo"`: 6 bytes | `taller.key().as_ref()`: 32 bytes | `id_equipo` (`u16` little-endian): 2 bytes
- **Límites y unicidad:**
  - Máximo **10** órdenes activas en `ordenes: Vec<Pubkey>` (validado con `require!(..., Errores::LimiteAlcanzado)`).
  - El `id_equipo` es asignado automáticamente por el programa (`taller.id_counter + 1`); no lo envía el usuario al registrar.
  - Unicidad por `(taller, id_equipo)`.

#### Cuenta `Orden` (hoja) — **78 bytes totales** (`INIT_SPACE = 70` + `8`)

| Campo | Tipo | `#[max_len]` | Cálculo Borsh (bytes) | Origen |
|---|---|---|---|---|
| `codigo` | `String` | `8` (`<= 32` por ser semilla, `<= 50`) | `4 + 8 = 12` | Caso de uso |
| `diagnostico` | `String` | `50` (`<= 50`) | `4 + 50 = 54` | Caso de uso |
| `costo` | `u32` | — | `4` | Caso de uso (unidades enteras, sin decimales) |
| **Discriminador Anchor** | — | — | `8` | Anchor |
| **Total asignado (`space`)** | | | **`78` bytes** | `Orden::INIT_SPACE + 8` |

- **Semillas PDA exactas:** `[b"orden", equipo.key().as_ref(), codigo.as_bytes()]`
  - `b"orden"`: 5 bytes
  - `equipo.key().as_ref()`: 32 bytes
  - `codigo.as_bytes()`: máx. 8 bytes UTF-8 (`<= 32` bytes)
- **Advertencia de unicidad y reutilización de código:**
  - La combinación **`(equipo, codigo)`** es única mientras la cuenta `Orden` exista on-chain: un mismo equipo no puede tener dos órdenes activas con el mismo `codigo`.
  - Al ejecutar `cerrar_orden` (que aplica `close = owner` en el contexto), la cuenta `Orden` se cierra, su renta vuelve al `owner` y ese `codigo` queda liberado, por lo que puede volver a utilizarse en una nueva orden para el mismo equipo.
  - `costo: u32` almacena un entero sin decimales (unidades enteras mínimas, máx. `4_294_967_295`).

---

## 3. Instrucciones y errores del programa (`pub mod taller`)

| # | Instrucción | Parámetros (orden exacto) | Cuentas del contexto (`init` / `mut` / `close` / validación) | Errores posibles |
|---|---|---|---|---|
| 1 | `crear_taller` | `nombre_taller: String` | `NuevoTaller`: `owner` (`Signer`, `mut`), `taller` (`init`, `payer = owner`, `space = Taller::INIT_SPACE + 8`, `seeds`, `bump`), `system_program` | Errores de sistema/Anchor (PDA ya existente, fondos insuficientes, longitud de semilla) |
| 2 | `registrar_equipo` | `modelo: String` | `NuevoEquipo`: `owner` (`Signer`, `mut`), `taller` (`mut`, `has_one = owner @ Errores::NoOwner`), `equipo` (`init`, `payer = owner`, `space = Equipo::INIT_SPACE + 8`, `seeds`, `bump`), `system_program` | `Errores::NoOwner`, `Errores::LimiteAlcanzado` (`equipos.len() >= 10`) |
| 3 | `crear_orden` | `_id_equipo: u16`, `codigo: String`, `diagnostico: String`, `costo: u32` | `NuevaOrden` (`#[instruction(id_equipo: u16, codigo: String)]`): `owner` (`Signer`, `mut`), `taller` (`has_one = owner @ Errores::NoOwner`, sin `mut`), `equipo` (`mut`, `seeds`, `bump`), `orden` (`init`, `payer = owner`, `space = Orden::INIT_SPACE + 8`, `seeds`, `bump`), `system_program` | `Errores::NoOwner`, `Errores::LimiteAlcanzado` (`ordenes.len() >= 10`) |
| 4 | `cambiar_costo` | `_id_equipo: u16`, `codigo: String`, `nuevo_costo: u32` | `ModificarOrden` (`#[instruction(id_equipo: u16, codigo: String)]`): `owner` (`Signer`, sin `mut`), `taller` (`has_one = owner @ Errores::NoOwner`, sin `mut`), `equipo` (`seeds`, `bump`, sin `mut`), `orden` (`mut`, `seeds`, `bump`) | `Errores::NoOwner` |
| 5 | `cerrar_orden` | `_id_equipo: u16`, `codigo: String` | `EliminarOrden` (`#[instruction(id_equipo: u16, codigo: String)]`): `owner` (`Signer`, `mut`), `taller` (`has_one = owner @ Errores::NoOwner`, sin `mut`), `equipo` (`mut`, `seeds`, `bump`), `orden` (`mut`, `close = owner`, `seeds`, `bump`) | `Errores::NoOwner`, `Errores::NoOrden` (`!equipo.ordenes.contains(&orden_key)`) |

### Códigos de error (`Errores`)

- `NoOwner`: `"Error, no eres el owner del taller"`
- `NoOrden`: `"Error, la orden no esta en el registro del equipo"`
- `LimiteAlcanzado`: `"Error, se alcanzo el limite maximo de 10 elementos"`

---

## 4. Resumen para el frontend (Sección 7.3 de `Prompt-1`)

Este resumen define el contrato exacto necesario para adaptar `Taller-Servicio-Solana-App` (`scripts/contrato-idl.mjs`, `src/solana/pdas.ts`, `src/solana/validaciones.ts`, `src/solana/acciones.ts`, `src/solana/lecturas.ts`):

- **Nombre del módulo Anchor / programa:** `taller` (`declare_id!("")` hasta desplegar en Devnet)
- **Árbol de semillas PDA (en orden exacto de bytes):**
  - `Taller`: `["taller", utf8(nombre_taller), ownerPubkeyBytes(32)]`
  - `Equipo`: `["equipo", tallerPubkeyBytes(32), u16LE(id_equipo)]` (al crear, usar `taller.idCounter + 1` en little-endian de 2 bytes)
  - `Orden`: `["orden", equipoPubkeyBytes(32), utf8(codigo)]`
- **Lista de instrucciones y argumentos en orden exacto** (en el IDL generado por Anchor los nombres de parámetros se convierten a `camelCase`):
  1. `crear_taller` (`crearTaller`): `nombre_taller: string` (`nombreTaller`)
  2. `registrar_equipo` (`registrarEquipo`): `modelo: string` (`modelo`)
  3. `crear_orden` (`crearOrden`): `_id_equipo: u16` (`idEquipo`), `codigo: string`, `diagnostico: string`, `costo: u32`
  4. `cambiar_costo` (`cambiarCosto`): `_id_equipo: u16` (`idEquipo`), `codigo: string`, `nuevo_costo: u32` (`nuevoCosto`)
  5. `cerrar_orden` (`cerrarOrden`): `_id_equipo: u16` (`idEquipo`), `codigo: string`
- **Límites que el frontend debe validar antes de firmar transacciones:**
  - `nombre_taller`: no vacío, máx. **30 bytes UTF-8** (`#[max_len(30)]`)
  - `modelo`: no vacío, máx. **30 bytes UTF-8** (`#[max_len(30)]`)
  - `codigo`: no vacío, máx. **8 bytes UTF-8** (`#[max_len(8)]`)
  - `diagnostico`: no vacío, máx. **50 bytes UTF-8** (`#[max_len(50)]`)
  - `id_equipo` (`u16`): entero `1..=65535` (`taller.id_counter` máx. `65_535`)
  - `costo` / `nuevo_costo` (`u32`): entero no negativo `<= 4_294_967_295`
  - Máximo de elementos por vector: **`10`** equipos por `Taller` (`equipos.len() < 10`) y **`10`** órdenes activas por `Equipo` (`ordenes.len() < 10`)

---

## 5. Pasos para compilar y desplegar en Solana Playground

1. Abrir **Solana Playground**: [https://beta.solpg.io/](https://beta.solpg.io/).
2. Crear o abrir un proyecto Anchor y reemplazar el contenido de `src/lib.rs` por el archivo `Taller-Servicio-Solana-PDA/src/lib.rs` de este repositorio (manteniendo `declare_id!("");` vacío antes del primer build o dejando que Playground lo complete).
3. En la pestaña **Build & Deploy**, hacer clic en **Build**.
   - Solana Playground compilará el programa SBF/BPF y completará automáticamente el Program ID dentro de `declare_id!("...")`.
4. Conectar o generar una wallet en Playground con SOL de **Devnet** (por ejemplo usando `solana airdrop 2` o el faucet de Devnet) y hacer clic en **Deploy** en **Devnet**.
5. Copiar el **Program ID** desplegado (el mismo valor que queda dentro de `declare_id!("...")`) para registrarlo en `entrega.txt` (*Dirección en Devnet*).
6. En la misma pestaña **Build & Deploy**, ir a la sección **IDL** y hacer clic en **Export** para descargar `idl.json`.
7. Usar ese `idl.json` descargado en el frontend (`Taller-Servicio-Solana-App`) para generar el cliente Tipado y verificar el contrato (por ejemplo ejecutando `npm run configurar:idl` y `npm run typecheck`).

---

## 6. Alcance de la verificación local realizada

- **Qué SÍ se verificó localmente:**
  - Compilación sintáctica, de tipos, préstamos (*borrow checker*) y *lifetimes* de `src/lib.rs` mediante `rustc 1.98.1` (`--edition 2021 --emit=metadata`) contra un stub temporal mínimo de `anchor_lang` / `anchor_macros` (eliminado tras la verificación).
  - Validación estática automatizada (Python `3.11.9`, eliminando comentarios) de todas las reglas de diseño de `Prompt-1`: ausencia de tipos prohibidos, `#[max_len]` dentro de límites, `#[derive(InitSpace)]`, `INIT_SPACE + 8`, 5 instrucciones con alineación exacta con `#[instruction(...)]`, `has_one = owner @ Errores::NoOwner`, `close = owner`, guardas `Errores::LimiteAlcanzado` / `Errores::NoOrden` y disciplina estricta de `mut`.
- **Qué NO se ejecutó localmente:**
  - **No se ejecutó `anchor build` localmente** (no se instalaron Anchor CLI, Solana CLI ni crates externos). Por ello, la generación de bytecode SBF, la expansión real de las macros de Anchor y la generación oficial de `idl.json` deben realizarse directamente en **Solana Playground** siguiendo la sección anterior.


---

## 7. Despliegue y pruebas en Devnet

- **Red:** Solana Devnet
- **Program ID:** `6uZx9cK4nttnnUZjzT5GpcjZ1zZsv7CtDjmYDSiCbnQ`
- **Prueba ejecutada en Solana Playground (`anchor.taller.test.ts`):**
  ```text
  Taller de Servicio (taller -> equipo -> orden)
    ✔  flujo completo: crear taller, registrar equipo, crear orden, cambiar costo y cerrar orden (5076ms)
  1 passing (5s)
  ```
