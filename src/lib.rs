use anchor_lang::prelude::*;

declare_id!("6uZx9cK4nttnnUZjzT5GpcjZ1zZsv7CtDjmYDSiCbnQ");

#[program]
pub mod taller {
    use super::*; // Importa todos los structs y enums definidos fuera del modulo

    /////////////////////////// INSTRUCCIONES ///////////////////////////
    /////////////////////////// Crear Taller ///////////////////////////
    pub fn crear_taller(context: Context<NuevoTaller>, nombre_taller: String) -> Result<()> {
        context.accounts.taller.set_inner(Taller {
            owner: context.accounts.owner.key(), // caller wallet
            nombre_taller: nombre_taller.clone(), // .clone() porque el String se reusa en el msg!
            equipos: Vec::new(),                  // El taller nace sin equipos. Guardara PDAs, no structs
            id_counter: 0,                        // Contador incremental, asigna un id unico a cada equipo
        }); // Crea el struct del taller, lo serializa y lo guarda en el espacio de la cuenta

        msg!("Taller: {} creado exitosamente!", nombre_taller); // Log de verificacion

        Ok(())
    }

    /////////////////////////// Registrar Equipo ///////////////////////////
    // "init" no puede ser condicional: Anchor crea las cuentas antes de entrar al handler.
    // Por eso el alta del equipo es su propia instruccion, separada de crear_orden.
    pub fn registrar_equipo(context: Context<NuevoEquipo>, modelo: String) -> Result<()> {
        require!(
            context.accounts.taller.equipos.len() < 10,
            Errores::LimiteAlcanzado
        ); // Evita exceder #[max_len(10)] antes de intentar serializar la cuenta

        let equipo_key = context.accounts.equipo.key(); // Se lee ANTES del &mut para no solapar prestamos

        let taller = &mut context.accounts.taller;

        // El id no es un argumento: lo asigna el programa. El contexto ya derivo la cuenta a
        // partir de este mismo valor, asi que aqui solo se confirma en el estado.
        let id_equipo = taller.id_counter + 1;
        taller.id_counter = id_equipo;
        taller.equipos.push(equipo_key); // El taller guarda la PDA del equipo, no sus datos

        context.accounts.equipo.set_inner(Equipo {
            id_equipo,
            modelo: modelo.clone(), // .clone() para no ceder la propiedad porque el String se reusa en el msg!
            ordenes_activas: 0,     // Nace sin ordenes: crear_orden es quien incrementa
            ordenes: Vec::new(),
        });

        msg!("Equipo {} registrado con id: {}", modelo, id_equipo); // Log de verificacion

        Ok(())
    }

    /////////////////////////// Crear Orden ///////////////////////////
    // id_equipo y codigo no se usan para modificar el id: viajan al contexto para derivar y validar
    // las cuentas. Ver NuevaOrden.
    pub fn crear_orden(
        context: Context<NuevaOrden>,
        _id_equipo: u16,
        codigo: String,
        diagnostico: String,
        costo: u32,
    ) -> Result<()> {
        require!(
            context.accounts.equipo.ordenes.len() < 10,
            Errores::LimiteAlcanzado
        ); // Evita exceder #[max_len(10)] antes de guardar la referencia en el vector

        context.accounts.orden.set_inner(Orden {
            codigo,
            diagnostico,
            costo,
        }); // Serializa y guarda el struct en la cuenta de la orden

        let orden_key = context.accounts.orden.key(); // Se lee ANTES del &mut de equipo

        let equipo = &mut context.accounts.equipo;

        equipo.ordenes.push(orden_key); // El vector guarda PDAs, no structs completos
        equipo.ordenes_activas += 1;

        msg!(
            "Orden registrada para el equipo con id: {}",
            equipo.id_equipo
        ); // Log de verificacion

        Ok(())
    }

    /////////////////////////// Cambiar Costo ///////////////////////////
    // La cuenta de la orden llega ya validada por el contexto: no hay que recorrer ningun vector
    // ni reconstruir la cadena a mano.
    pub fn cambiar_costo(
        context: Context<ModificarOrden>,
        _id_equipo: u16,
        codigo: String,
        nuevo_costo: u32,
    ) -> Result<()> {
        let orden = &mut context.accounts.orden;
        let viejo_costo = orden.costo;
        orden.costo = nuevo_costo;

        msg!(
            "El costo de la orden con codigo: {}, paso de: {}, a: {}",
            codigo,
            viejo_costo,
            nuevo_costo
        ); // Log de verificacion

        Ok(())
    }

    /////////////////////////// Cerrar Orden ///////////////////////////
    // El contexto EliminarOrden lleva "close = owner": la cuenta de la orden se cierra al final
    // y su rent vuelve al owner.
    pub fn cerrar_orden(
        context: Context<EliminarOrden>,
        _id_equipo: u16,
        codigo: String,
    ) -> Result<()> {
        let orden_key = context.accounts.orden.key(); // Se lee ANTES del &mut de equipo

        let equipo = &mut context.accounts.equipo;

        require!(equipo.ordenes.contains(&orden_key), Errores::NoOrden);
        // La orden existe y pertenece a este equipo (lo garantizan las seeds), pero el vector
        // es el indice de lectura: si la referencia no esta, restar ordenes_activas lo desincronizaria.

        equipo.ordenes.retain(|&k| k != orden_key); // Quita la referencia del vector
        equipo.ordenes_activas -= 1;

        msg!(
            "Orden con codigo: {}, cerrada para el equipo con id: {}",
            codigo,
            equipo.id_equipo
        ); // Log de verificacion

        Ok(())
    }
}

/////////////////////////// Codigos de Error ///////////////////////////
#[error_code]
pub enum Errores {
    #[msg("Error, no eres el owner del taller")]
    NoOwner,
    #[msg("Error, la orden no esta en el registro del equipo")]
    NoOrden,
    #[msg("Error, se alcanzo el limite maximo de 10 elementos")]
    LimiteAlcanzado,
}

/////////////////////////// CUENTAS ///////////////////////////
/////////////////////////// Taller ///////////////////////////

#[account]
#[derive(InitSpace)]
pub struct Taller {
    pub owner: Pubkey, // pub: has_one = owner necesita leer este campo desde el contexto

    #[max_len(30)]
    nombre_taller: String,

    #[max_len(10)] // Guarda PDAs (32 bytes c/u), no structs completos
    equipos: Vec<Pubkey>,

    id_counter: u16,
}

/////////////////////////// Equipo ///////////////////////////

#[account]
#[derive(InitSpace, PartialEq)]
pub struct Equipo {
    id_equipo: u16,

    #[max_len(30)]
    modelo: String,

    ordenes_activas: u16,

    #[max_len(10)]
    ordenes: Vec<Pubkey>,
}

/////////////////////////// Orden ///////////////////////////

#[account]
#[derive(InitSpace, PartialEq)]
pub struct Orden {
    #[max_len(8)]
    codigo: String,

    #[max_len(50)]
    diagnostico: String,

    costo: u32,
}

/////////////////////////// CONTEXTOS ///////////////////////////
/*
La jerarquia del modelo vive en las seeds:

    taller  <- [b"taller", nombre_taller, owner]
    equipo  <- [b"equipo", taller, id_equipo]
    orden   <- [b"orden",  equipo, codigo]

Cada cuenta se deriva de su padre, asi que la pertenencia queda garantizada por construccion:
si la direccion coincide, el equipo ES de ese taller. Por eso ya no hace falta recorrer
el vector para validar; los vectores quedan como indice de lectura para el frontend.

El "has_one = owner" cierra la cadena por arriba: comprueba que taller.owner == owner.key(),
es decir, que quien firma es el dueno del taller desde el que se deriva todo lo demas.
*/

/////////////////////////// Nuevo Taller ///////////////////////////
/// Instruccion: crear_taller

#[derive(Accounts)]
#[instruction(nombre_taller: String)]
pub struct NuevoTaller<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Taller::INIT_SPACE + 8,
        seeds = [b"taller", nombre_taller.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub taller: Account<'info, Taller>,

    pub system_program: Program<'info, System>,
}

/////////////////////////// Nuevo Equipo ///////////////////////////
/// Instruccion: registrar_equipo

#[derive(Accounts)]
pub struct NuevoEquipo<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ Errores::NoOwner)]
    pub taller: Account<'info, Taller>,

    #[account(
        init,
        payer = owner,
        space = Equipo::INIT_SPACE + 8,
        // El id sale del contador del propio taller: el programa lo asigna, nadie lo envia.
        // to_le_bytes() porque un u16 no tiene as_bytes(): ese metodo es de String/str
        seeds = [b"equipo", taller.key().as_ref(), (taller.id_counter + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub equipo: Account<'info, Equipo>,

    pub system_program: Program<'info, System>,
}

/////////////////////////// Nueva Orden ///////////////////////////
/// Instruccion: crear_orden

#[derive(Accounts)]
#[instruction(id_equipo: u16, codigo: String)]
pub struct NuevaOrden<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(has_one = owner @ Errores::NoOwner)]
    pub taller: Account<'info, Taller>, // Sin mut: solo se lee para derivar al equipo

    #[account(
        mut,
        seeds = [b"equipo", taller.key().as_ref(), id_equipo.to_le_bytes().as_ref()],
        bump
    )]
    pub equipo: Account<'info, Equipo>,

    #[account(
        init,
        payer = owner,
        space = Orden::INIT_SPACE + 8,
        // El codigo entra en los seeds: un equipo no puede repetir el mismo codigo de orden
        seeds = [b"orden", equipo.key().as_ref(), codigo.as_bytes()],
        bump
    )]
    pub orden: Account<'info, Orden>,

    pub system_program: Program<'info, System>,
}

/////////////////////////// Modificar Orden ///////////////////////////
/// Instruccion: cambiar_costo

#[derive(Accounts)]
#[instruction(id_equipo: u16, codigo: String)]
pub struct ModificarOrden<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ Errores::NoOwner)]
    pub taller: Account<'info, Taller>,

    #[account(
        seeds = [b"equipo", taller.key().as_ref(), id_equipo.to_le_bytes().as_ref()],
        bump
    )]
    pub equipo: Account<'info, Equipo>, // Sin mut: solo se lee, para derivar la orden

    #[account(
        mut,
        seeds = [b"orden", equipo.key().as_ref(), codigo.as_bytes()],
        bump
    )]
    pub orden: Account<'info, Orden>,
}

/////////////////////////// Eliminar Orden ///////////////////////////
/// Instruccion: cerrar_orden -> cierra la cuenta

#[derive(Accounts)]
#[instruction(id_equipo: u16, codigo: String)]
pub struct EliminarOrden<'info> {
    #[account(mut)]
    pub owner: Signer<'info>, // mut: recibe el rent de la cuenta cerrada

    #[account(has_one = owner @ Errores::NoOwner)]
    pub taller: Account<'info, Taller>, // Sin mut: el taller no cambia al cerrar una orden

    #[account(
        mut,
        seeds = [b"equipo", taller.key().as_ref(), id_equipo.to_le_bytes().as_ref()],
        bump
    )]
    pub equipo: Account<'info, Equipo>,

    #[account(
        mut,
        close = owner,
        seeds = [b"orden", equipo.key().as_ref(), codigo.as_bytes()],
        bump
    )]
    pub orden: Account<'info, Orden>,
}
