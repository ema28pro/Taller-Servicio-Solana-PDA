// No imports needed in Solana Playground: web3, anchor, pg, assert are globally available

describe("Taller de Servicio (taller -> equipo -> orden)", () => {
  const owner = pg.wallet.publicKey;
  const nombreTaller = `Taller_${Date.now().toString().slice(-6)}`; // <= 30 bytes, unico por corrida
  const modeloEquipo = "ThinkPad X1";
  const codigoOrden = "ORD-01";
  const diagnostico = "Limpieza interna y pasta termica";
  const costoInicial = 50000; // 500.00 en centavos
  const costoNuevo = 65000; // 650.00 en centavos

  function u16ToBytes(valor: number): Buffer {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(valor, 0);
    return buf;
  }

  function deriveTaller(nombre: string) {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("taller"), Buffer.from(nombre), owner.toBuffer()],
      pg.PROGRAM_ID
    )[0];
  }

  function deriveEquipo(tallerPda: web3.PublicKey, idEquipo: number) {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("equipo"), tallerPda.toBuffer(), u16ToBytes(idEquipo)],
      pg.PROGRAM_ID
    )[0];
  }

  function deriveOrden(equipoPda: web3.PublicKey, codigo: string) {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("orden"), equipoPda.toBuffer(), Buffer.from(codigo)],
      pg.PROGRAM_ID
    )[0];
  }

  it("flujo completo: crear taller, registrar equipo, crear orden, cambiar costo y cerrar orden", async () => {
    const tallerPda = deriveTaller(nombreTaller);

    // 1. Crear Taller
    const txTaller = await pg.program.methods
      .crearTaller(nombreTaller)
      .accounts({
        owner,
        taller: tallerPda,
      })
      .rpc();
    await pg.connection.confirmTransaction(txTaller);

    let tallerAcc = await pg.program.account.taller.fetch(tallerPda);
    assert.strictEqual(tallerAcc.nombreTaller, nombreTaller);
    assert.strictEqual(tallerAcc.idCounter, 0);
    assert.strictEqual(tallerAcc.equipos.length, 0);

    // 2. Registrar Equipo (id_equipo = id_counter + 1 = 1)
    const idEquipo = tallerAcc.idCounter + 1;
    const equipoPda = deriveEquipo(tallerPda, idEquipo);

    const txEquipo = await pg.program.methods
      .registrarEquipo(modeloEquipo)
      .accounts({
        owner,
        taller: tallerPda,
        equipo: equipoPda,
      })
      .rpc();
    await pg.connection.confirmTransaction(txEquipo);

    tallerAcc = await pg.program.account.taller.fetch(tallerPda);
    assert.strictEqual(tallerAcc.idCounter, 1);
    assert.strictEqual(tallerAcc.equipos.length, 1);

    let equipoAcc = await pg.program.account.equipo.fetch(equipoPda);
    assert.strictEqual(equipoAcc.idEquipo, 1);
    assert.strictEqual(equipoAcc.modelo, modeloEquipo);
    assert.strictEqual(equipoAcc.ordenesActivas, 0);

    // 3. Crear Orden
    const ordenPda = deriveOrden(equipoPda, codigoOrden);

    const txOrden = await pg.program.methods
      .crearOrden(idEquipo, codigoOrden, diagnostico, costoInicial)
      .accounts({
        owner,
        taller: tallerPda,
        equipo: equipoPda,
        orden: ordenPda,
      })
      .rpc();
    await pg.connection.confirmTransaction(txOrden);

    let ordenAcc = await pg.program.account.orden.fetch(ordenPda);
    assert.strictEqual(ordenAcc.codigo, codigoOrden);
    assert.strictEqual(ordenAcc.diagnostico, diagnostico);
    assert.strictEqual(ordenAcc.costo, costoInicial);

    equipoAcc = await pg.program.account.equipo.fetch(equipoPda);
    assert.strictEqual(equipoAcc.ordenesActivas, 1);
    assert.strictEqual(equipoAcc.ordenes.length, 1);

    // 4. Cambiar Costo
    const txCosto = await pg.program.methods
      .cambiarCosto(idEquipo, codigoOrden, costoNuevo)
      .accounts({
        owner,
        taller: tallerPda,
        equipo: equipoPda,
        orden: ordenPda,
      })
      .rpc();
    await pg.connection.confirmTransaction(txCosto);

    ordenAcc = await pg.program.account.orden.fetch(ordenPda);
    assert.strictEqual(ordenAcc.costo, costoNuevo);

    // 5. Cerrar Orden (close = owner)
    const txCerrar = await pg.program.methods
      .cerrarOrden(idEquipo, codigoOrden)
      .accounts({
        owner,
        taller: tallerPda,
        equipo: equipoPda,
        orden: ordenPda,
      })
      .rpc();
    await pg.connection.confirmTransaction(txCerrar);

    equipoAcc = await pg.program.account.equipo.fetch(equipoPda);
    assert.strictEqual(equipoAcc.ordenesActivas, 0);
    assert.strictEqual(equipoAcc.ordenes.length, 0);

    const closedInfo = await pg.connection.getAccountInfo(ordenPda);
    assert.strictEqual(closedInfo, null);
  });
});
