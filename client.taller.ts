//////////////////// Imports ////////////////////
import { PublicKey } from "@solana/web3.js";

////////////////// Constantes ////////////////////
const nombre_taller = "Taller Demo"; // Nombre del taller (max 30 bytes)
const owner = pg.wallet.publicKey; // Wallet

//////////////////// Client Test Logs ////////////////////
console.log("My address:", owner.toString()); // Ver el address
const balance = await pg.connection.getBalance(owner);
console.log(`My balance: ${balance / web3.LAMPORTS_PER_SOL} SOL`); // Ver el saldo en SOL

//////////////////// OBTENER PDAs ////////////////////
/*
Las semillas siguen la jerarquia del modelo. Cada cuenta se deriva de su padre:

    taller  <- ["taller", nombre_taller, owner]
    equipo  <- ["equipo", taller, id_equipo]
    orden   <- ["orden",  equipo, codigo]

Para llegar a una orden hay que derivar primero el taller y luego el equipo.
*/

//////////////////// Helper: u16 a bytes ////////////////////
// En Rust las seeds numericas usan .to_le_bytes() (2 bytes little-endian para u16).
function u16ToBytes(valor: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(valor, 0);
  return buffer;
}

//////////////////// Taller ////////////////////
function pdaTaller(nombre: string) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("taller"), // Semilla 1: b"taller"
      Buffer.from(nombre), // Semilla 2: nombre_taller -> String
      owner.toBuffer(), // Semilla 3: owner -> Pubkey
    ],
    pg.PROGRAM_ID
  );
}

//////////////////// Equipo ////////////////////
// Depende del taller
function pdaEquipo(pda_taller: PublicKey, id_equipo: number) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("equipo"), // Semilla 1: b"equipo"
      pda_taller.toBuffer(), // Semilla 2: cuenta padre -> Pubkey
      u16ToBytes(id_equipo), // Semilla 3: id_equipo -> u16 little-endian
    ],
    pg.PROGRAM_ID
  );
}

//////////////////// Orden ////////////////////
// Depende del equipo. El codigo en las semillas impide que un equipo repita codigo de orden.
function pdaOrden(pda_equipo: PublicKey, codigo: string) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("orden"), // Semilla 1: b"orden"
      pda_equipo.toBuffer(), // Semilla 2: cuenta padre -> Pubkey
      Buffer.from(codigo), // Semilla 3: codigo -> String
    ],
    pg.PROGRAM_ID
  );
}

//////////////////// Helper: la cadena completa ////////////////////
function cadena(nombre: string, id_equipo: number, codigo: string) {
  const [taller] = pdaTaller(nombre);
  const [equipo] = pdaEquipo(taller, id_equipo);
  const [orden] = codigo ? pdaOrden(equipo, codigo) : [null];
  return { taller, equipo, orden };
}

//////////////////// Siguiente id disponible ////////////////////
async function siguienteId(nombre: string) {
  const [pda_taller] = pdaTaller(nombre);
  const tallerAccount = await pg.program.account.taller.fetch(pda_taller);
  return tallerAccount.idCounter + 1;
}

//////////////////// Crear Taller ////////////////////
async function crearTaller(nombre: string) {
  const [pda_taller] = pdaTaller(nombre);

  const txHash = await pg.program.methods
    .crearTaller(nombre)
    .accounts({
      owner,
      taller: pda_taller,
    })
    .rpc();

  console.log("crearTaller txHash:", txHash);
}

//////////////////// Registrar Equipo ////////////////////
async function registrarEquipo(nombre: string, modelo: string) {
  const id_equipo = await siguienteId(nombre);
  const { taller, equipo } = cadena(nombre, id_equipo, "");

  const txHash = await pg.program.methods
    .registrarEquipo(modelo)
    .accounts({
      owner,
      taller,
      equipo,
    })
    .rpc();

  console.log("registrarEquipo txHash:", txHash);
  console.log(`Equipo "${modelo}" registrado con id:`, id_equipo);

  return id_equipo;
}

//////////////////// Crear Orden ////////////////////
async function crearOrden(
  nombre: string,
  id_equipo: number,
  codigo: string,
  diagnostico: string,
  costo: number
) {
  const { taller, equipo, orden } = cadena(nombre, id_equipo, codigo);

  const txHash = await pg.program.methods
    .crearOrden(id_equipo, codigo, diagnostico, costo)
    .accounts({
      owner,
      taller,
      equipo,
      orden: orden!,
    })
    .rpc();

  console.log("crearOrden txHash:", txHash);
}

//////////////////// Cambiar Costo ////////////////////
async function cambiarCosto(
  nombre: string,
  id_equipo: number,
  codigo: string,
  nuevo_costo: number
) {
  const { taller, equipo, orden } = cadena(nombre, id_equipo, codigo);

  const txHash = await pg.program.methods
    .cambiarCosto(id_equipo, codigo, nuevo_costo)
    .accounts({
      owner,
      taller,
      equipo,
      orden: orden!,
    })
    .rpc();

  console.log("cambiarCosto txHash:", txHash);
}

//////////////////// Cerrar Orden ////////////////////
// Cierra la cuenta con 'close = owner' y devuelve el rent al owner.
async function cerrarOrden(nombre: string, id_equipo: number, codigo: string) {
  const { taller, equipo, orden } = cadena(nombre, id_equipo, codigo);

  const txHash = await pg.program.methods
    .cerrarOrden(id_equipo, codigo)
    .accounts({
      owner,
      taller,
      equipo,
      orden: orden!,
    })
    .rpc();

  console.log("cerrarOrden txHash:", txHash);
}

//////////////////// Ver Equipos y Ordenes ////////////////////
async function verEquipos(nombre: string) {
  const [pda_taller] = pdaTaller(nombre);

  try {
    const tallerAccount = await pg.program.account.taller.fetch(pda_taller);

    console.log("Taller:", tallerAccount.nombreTaller);
    console.log("Ultimo id asignado:", tallerAccount.idCounter);

    const numero_equipos = tallerAccount.equipos.length;

    if (numero_equipos === 0) {
      console.log("Taller vacio, aun no hay equipos");
      return;
    }

    console.log("Cantidad de equipos:", numero_equipos);

    for (let i = 0; i < numero_equipos; i++) {
      const equipoKey = tallerAccount.equipos[i];
      const equipoAccount = await pg.program.account.equipo.fetch(equipoKey);

      console.log(
        `\nEquipo #${i + 1}: ${equipoAccount.modelo}\n * Id: ${
          equipoAccount.idEquipo
        }\n * Ordenes activas: ${
          equipoAccount.ordenesActivas
        }\n * Direccion (PDA): ${equipoKey.toBase58()}`
      );

      for (let j = 0; j < equipoAccount.ordenes.length; j++) {
        const ordenKey = equipoAccount.ordenes[j];
        const ordenAccount = await pg.program.account.orden.fetch(ordenKey);

        console.log(
          `   Orden #${j + 1}: ${ordenAccount.codigo} | ${
            ordenAccount.diagnostico
          } | $${(ordenAccount.costo / 100).toFixed(2)} | PDA: ${ordenKey.toBase58()}`
        );
      }
    }
  } catch (error: any) {
    console.error("Error viendo equipos:", error);
    if (error?.message) console.error("Mensaje de error:", error.message);
    if (error?.logs) console.error("Logs del programa:", error.logs);
  }
}

//////////////////// Alta de equipo nuevo con orden ////////////////////
async function equipoNuevoConOrden(
  nombre: string,
  modelo: string,
  codigo: string,
  diagnostico: string,
  costo: number
) {
  const id_equipo = await registrarEquipo(nombre, modelo); // Transaccion 1
  await crearOrden(nombre, id_equipo, codigo, diagnostico, costo); // Transaccion 2

  console.log("Alta completa para el equipo con id:", id_equipo);
  return id_equipo;
}

// Flujo de ejemplo (descomenta segun lo que quieras probar en Solana Playground):
await crearTaller(nombre_taller);
// await equipoNuevoConOrden(nombre_taller, "Laptop Dell XPS", "ORD-001", "Cambio de bateria", 15000);
// await cambiarCosto(nombre_taller, 1, "ORD-001", 18500);
// await verEquipos(nombre_taller);
// await cerrarOrden(nombre_taller, 1, "ORD-001");
