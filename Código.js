/**
* (MODIFICADO)
* Lee la celda B24 de "Config" y la pasa al frontend.
*/
function doGet(e) {
  try {
    const params = e.parameter;
    Logger.log("doGet INICIADO. Parámetros de URL: " + JSON.stringify(params));

    const appUrl = ScriptApp.getService().getUrl();

    if (params.status === 'failure') {
      Logger.log("doGet detectó 'status=failure'. Redirigiendo al formulario.");
    }
    else {
      let paymentId = null;
      if (params) {
        if (params.payment_id) {
          paymentId = params.payment_id;
        } else if (params.data && typeof params.data === 'string' && params.data.startsWith('{')) {
          try {
            const dataObj = JSON.parse(params.data);
            if (dataObj.id) paymentId = dataObj.id;
          } catch (jsonErr) {
            Logger.log("No se pudo parsear e.parameter.data: " + params.data);
          }
        } else if (params.topic && params.topic === 'payment' && params.id) {
          paymentId = params.id;
        }
      }

      if (paymentId) {
        return handleMPRedirect(params, appUrl);
      }
    }

    const htmlTemplate = HtmlService.createTemplateFromFile('Index');
    htmlTemplate.appUrl = appUrl;

    // --- (INICIO DE CORRECCIÓN) ---
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    // B24: Ocultar/mostrar "a) Comprobante 1 pago..."
    htmlTemplate.pagoTotalMPVisible = hojaConfig.getRange('B24').getValue(); 
    
    // Variables para la lógica de auto-validación de hermanos
    htmlTemplate.dniHermano = '';
    htmlTemplate.tipoHermano = '';
    htmlTemplate.nombreHermano = '';
    htmlTemplate.apellidoHermano = '';
    htmlTemplate.fechaNacHermano = '';
    // --- (FIN DE CORRECCIÓN) ---

    const html = htmlTemplate.evaluate()
      .setTitle("Formulario de Registro")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    return html;

  } catch (err) {
    Logger.log("Error en la detección de parámetros de doGet: " + err.toString());
    return HtmlService.createHtmlOutput("<b>Ocurrió un error:</b> " + err.message);
  }
}

function doPost(e) {
  return handleMPWebhook(e);
}

function registrarDatos(datos) {
  Logger.log("REGISTRAR DATOS INICIADO. Datos: " + JSON.stringify(datos));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);

    const fechaNacPrincipal = datos.fechaNacimiento;
    if (!fechaNacPrincipal || fechaNacPrincipal < "2010-01-01" || fechaNacPrincipal > "2023-12-31") {
      return { status: 'ERROR', message: 'La fecha de nacimiento del inscripto principal debe estar entre 01/01/2010 y 31/12/2023.' };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    let estadoActual = obtenerEstadoRegistro();

    if (estadoActual.cierreManual) return { status: 'CERRADO', message: 'El registro se encuentra cerrado.' };
    if (datos.tipoInscripto !== 'preventa' && estadoActual.alcanzado) return { status: 'LIMITE_ALCANZADO', message: 'Se ha alcanzado el cupo máximo.' };
    if (datos.tipoInscripto !== 'preventa' && datos.jornada === 'Jornada Normal extendida' && estadoActual.jornadaExtendidaAlcanzada) {
      return { status: 'LIMITE_EXTENDIDA', message: 'Se agotó el cupo para Jornada Extendida.' };
    }

    const dniBuscado = limpiarDNI(datos.dni);

    let hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    let rangoDniRegistro = null;
    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    }

    if (rangoDniRegistro) {
      const celdaRegistro = rangoDniRegistro.createTextFinder(dniBuscado).matchEntireCell(true).findNext();
      if (celdaRegistro) {
        Logger.log(`BLOQUEO DE REGISTRO: El DNI ${dniBuscado} ya existe en la fila ${celdaRegistro.getRow()}.`);
        return { status: 'ERROR', message: `El DNI ${dniBuscado} ya se encuentra registrado. No se puede crear un duplicado.` };
      }
    }

    if (!hojaRegistro) {
      hojaRegistro = ss.insertSheet(NOMBRE_HOJA_REGISTRO);
      hojaRegistro.appendRow([
        'N° de Turno', 'Marca temporal', 'Marca N/E', 'Estado', // A-D
        'Email', 'Nombre', 'Apellido', // E-G
        'Fecha de Nacimiento', 'GRUPOS', 'DNI', // H-J
        'Obra Social', 'Colegio/Jardin', // K-L
        'Responsable 1', 'DNI Resp 1', 'Tel Resp 1', // M-O
        'Responsable 2', 'Tel Resp 2', // P-Q
        'Autorizados', // R
        'Deporte', 'Espec. Deporte', 'Enfermedad', 'Espec. Enfermedad', 'Alergia', 'Espec. Alergia', // S-X
        'Aptitud Física (Link)', 'Foto Carnet (Link)', // Y-Z
        'Jornada', 'SOCIO', // AA-AB
        'Método de Pago', // AC
        'Precio', // AD
        'Cuota 1', 'Cuota 2', 'Cuota 3', 'Cantidad Cuotas', // AE-AH
        'Estado de Pago', // AI
        'Monto a Pagar', // AJ
        'ID Pago MP', 'Nombre Pagador (MP)', 'DNI Pagador MP', // AK-AM
        'Nombre y Apellido (Pagador Manual)', 'DNI Pagador (Manual)', // AN-AO
        'Comprobante MP', // AP
        'Comprobante Manual (Total/Ext)', // AQ
        'Comprobante Manual (C1)', // AR
        'Comprobante Manual (C2)', // AS
        'Comprobante Manual (C3)', // AT
        'Enviar Email?', // AU
        'Turno Principal' // AV
      ]);
      rangoDniRegistro = null;
    }

    const { precio, montoAPagar } = obtenerPrecioDesdeConfig(datos.metodoPago, datos.cantidadCuotas, hojaConfig);

    const lastRow = hojaRegistro.getLastRow();
    let ultimoTurno = 0;
    if (lastRow > 1) {
      const rangoTurnos = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1).getValues();
      const turnosReales = rangoTurnos.map(f => f[0]).filter(Number);
      if (turnosReales.length > 0) {
        ultimoTurno = Math.max(...turnosReales);
      }
    }
    const nuevoNumeroDeTurno = ultimoTurno + 1;

    const edadCalculada = calcularEdad(datos.fechaNacimiento);
    const textoGrupo = `GRUPO ${edadCalculada.anos} AÑOS`;

    const fechaObj = new Date(datos.fechaNacimiento);
    const fechaFormateada = Utilities.formatDate(fechaObj, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');

    let marcaNE = "";
    let estadoInscripto = "";
    const esPreventa = (datos.tipoInscripto === 'preventa');

    if (datos.jornada === 'Jornada Normal extendida') {
      marcaNE = esPreventa ? "Extendida (Pre-venta)" : "Extendida";
    } else {
      marcaNE = esPreventa ? "Normal (Pre-Venta)" : "Normal";
    }

    if (esPreventa) {
      estadoInscripto = "Pre-Venta";
    } else {
      estadoInscripto = (datos.tipoInscripto === 'nuevo') ? 'Nuevo' : 'Anterior';
    }

    const telResp1 = `(${datos.telAreaResp1}) ${datos.telNumResp1}`;
    const telResp2 = (datos.telAreaResp2 && datos.telNumResp2) ? `(${datos.telAreaResp2}) ${datos.telNumResp2}` : '';

    const filaNueva = [
      nuevoNumeroDeTurno, new Date(), marcaNE, estadoInscripto, // A-D
      datos.email, datos.nombre, datos.apellido, // E-G
      fechaFormateada, textoGrupo, dniBuscado, // H-J
      datos.obraSocial, datos.colegioJardin, // K-L
      datos.adultoResponsable1, datos.dniResponsable1, telResp1, // M-O
      datos.adultoResponsable2, telResp2, // P-Q
      datos.personasAutorizadas, // R
      datos.practicaDeporte, datos.especifiqueDeporte, datos.tieneEnfermedad, datos.especifiqueEnfermedad, datos.esAlergico, datos.especifiqueAlergia, // S-X
      datos.urlCertificadoAptitud || '', datos.urlFotoCarnet || '', // Y-Z
      datos.jornada, datos.esSocio, // AA-AB
      datos.metodoPago, // AC
      precio, // AD (Precio)
      '', '', '', parseInt(datos.cantidadCuotas) || 0, // AE-AH
      datos.estadoPago, // AI (Estado de Pago)
      montoAPagar, // AJ (Monto a Pagar)
      '', '', '', // AK-AM
      '', '', // AN-AO
      '', // AP
      '', '', '', '', // AQ-AT
      false, // AU
      nuevoNumeroDeTurno // AV
    ];
    hojaRegistro.appendRow(filaNueva);
    const filaInsertada = hojaRegistro.getLastRow();

    if (rangoDniRegistro == null) {
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    }

    aplicarColorGrupo(hojaRegistro, filaInsertada, textoGrupo, hojaConfig);

    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    hojaRegistro.getRange(filaInsertada, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule);
    hojaRegistro.getRange(filaInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0");

    let hermanosConEstado = [];

    if (datos.hermanos && datos.hermanos.length > 0) {
      const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);

      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      let dnisHermanosEnEsteLote = new Set();

      let proximoTurnoHermano = nuevoNumeroDeTurno;

      for (const hermano of datos.hermanos) {
        proximoTurnoHermano++;

        const dniHermano = limpiarDNI(hermano.dni);
        if (!dniHermano || !hermano.nombre || !hermano.apellido || !hermano.fechaNac) continue;

        if (hermano.fechaNac < "2010-01-01" || hermano.fechaNac > "2023-12-31") {
          return { status: 'ERROR', message: `La fecha de nacimiento del hermano/a (${hermano.nombre}) debe estar entre 01/01/2010 y 31/12/2023.` };
        }

        if (dniHermano === dniBuscado) {
          return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}) no puede ser igual al del inscripto principal.` };
        }
        if (dnisHermanosEnEsteLote.has(dniHermano)) {
          return { status: 'ERROR', message: `El DNI ${dniHermano} está repetido entre los hermanos. Por favor, revise los datos.` };
        }
        dnisHermanosEnEsteLote.add(dniHermano);

        const celdaRegistroHermano = rangoDniRegistro.createTextFinder(dniHermano).matchEntireCell(true).findNext();
        if (celdaRegistroHermano) {
          return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}: ${dniHermano}) ya se encuentra registrado. No se puede crear un duplicado.` };
        }

        let estadoHermano = "Nuevo Hermano/a";
        if (hojaBusqueda && hojaBusqueda.getLastRow() > 1) {
          const rangoDNI = hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1);
          const celdaEncontrada = rangoDNI.createTextFinder(dniHermano).matchEntireCell(true).findNext();
          if (celdaEncontrada) {
            estadoHermano = "Anterior Hermano/a";
          }
        }

        const tipoHermano = estadoHermano.includes('Anterior') ? 'anterior' : 'nuevo';
        hermanosConEstado.push({
          nombre: hermano.nombre,
          apellido: hermano.apellido,
          dni: dniHermano,
          tipo: tipoHermano
        });

        const edadCalcHermano = calcularEdad(hermano.fechaNac);
        const textoGrupoHermano = `GRUPO ${edadCalcHermano.anos} AÑOS`;
        const fechaObjHermano = new Date(hermano.fechaNac);
        const fechaFmtHermano = Utilities.formatDate(fechaObjHermano, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');

        const filaHermano = [
          proximoTurnoHermano, new Date(), '', estadoHermano, // A-D
          datos.email, hermano.nombre, hermano.apellido, // E-G
          fechaFmtHermano, textoGrupoHermano, dniHermano, // H-J
          datos.obraSocial, '', // K-L
          datos.adultoResponsable1, datos.dniResponsable1, telResp1, // M-O
          datos.adultoResponsable2, telResp2, // P-Q
          datos.personasAutorizadas, // R
          '', '', '', '', '', '', // S-X
          '', '', // Y-Z
          '', '', // AA-AB
          '', // AC
          0, // AD
          '', '', '', 0, // AE-AH
          'Pendiente (Hermano)', // AI
          0, // AJ
          '', '', '', // AK-AM
          '', '', // AN-AO
          '', // AP
          '', '', '', '', // AQ-AT
          false, // AU
          nuevoNumeroDeTurno // AV
        ];
        hojaRegistro.appendRow(filaHermano);
        const filaHermanoInsertada = hojaRegistro.getLastRow();

        aplicarColorGrupo(hojaRegistro, filaHermanoInsertada, textoGrupoHermano, hojaConfig);

        hojaRegistro.getRange(filaHermanoInsertada, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule);
        hojaRegistro.getRange(filaHermanoInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0");

        rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      }
    }

    SpreadsheetApp.flush();
    obtenerEstadoRegistro();

    return {
      status: 'OK_REGISTRO',
      message: '¡Registro Exitoso!',
      numeroDeTurno: nuevoNumeroDeTurno,
      datos: datos,
      hermanosRegistrados: hermanosConEstado
    };

  } catch (e) {
    Logger.log("ERROR CRÍTICO EN REGISTRO: " + e.toString());
    return { status: 'ERROR', message: 'Fallo al registrar los datos: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function actualizarDatosHermano(datos) {
  Logger.log("ACTUALIZAR DATOS HERMANO INICIADO. Datos: " + JSON.stringify(datos));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);

    const dniBuscado = limpiarDNI(datos.dni);

    const fechaNac = datos.fechaNacimiento;
    if (!fechaNac || fechaNac < "2010-01-01" || fechaNac > "2023-12-31") {
      return { status: 'ERROR', message: 'La fecha de nacimiento debe estar entre 01/01/2010 y 31/12/2023.' };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);

    if (!hojaRegistro) {
      return { status: 'ERROR', message: 'Hoja de Registros no encontrada.' };
    }

    const rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    const celdaRegistro = rangoDniRegistro.createTextFinder(dniBuscado).matchEntireCell(true).findNext();

    if (!celdaRegistro) {
      return { status: 'ERROR', message: `No se encontró el DNI ${dniBuscado} para actualizar. Por favor, reinicie el formulario.` };
    }

    const fila = celdaRegistro.getRow();
    const rangoFila = hojaRegistro.getRange(fila, 1, 1, hojaRegistro.getLastColumn());

    const metodoPagoActual = hojaRegistro.getRange(fila, COL_METODO_PAGO).getValue();
    if (metodoPagoActual) {
      Logger.log(`BLOQUEO DE ACTUALIZACIÓN: El hermano DNI ${dniBuscado} (Fila ${fila}) ya completó su registro.`);
      return { status: 'ERROR', message: 'Este DNI ya completó su registro y seleccionó un método de pago. No se puede modificar.' };
    }

    const numeroDeTurno = hojaRegistro.getRange(fila, COL_NUMERO_TURNO).getValue();
    const estadoInscripto = hojaRegistro.getRange(fila, COL_ESTADO_NUEVO_ANT).getValue(); 
    const turnoPrincipal = hojaRegistro.getRange(fila, COL_VINCULO_PRINCIPAL).getValue();

    const { precio, montoAPagar } = obtenerPrecioDesdeConfig(datos.metodoPago, datos.cantidadCuotas, hojaConfig);
    const edadCalculada = calcularEdad(datos.fechaNacimiento);
    const textoGrupo = `GRUPO ${edadCalculada.anos} AÑOS`;
    const fechaObj = new Date(datos.fechaNacimiento);
    const fechaFormateada = Utilities.formatDate(fechaObj, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    
    let marcaNE = "";
    if (datos.jornada === 'Jornada Normal extendida') {
      marcaNE = "Extendida";
    } else {
      marcaNE = "Normal";
    }
    
    const telResp1 = `(${datos.telAreaResp1}) ${datos.telNumResp1}`;
    const telResp2 = (datos.telAreaResp2 && datos.telNumResp2) ? `(${datos.telAreaResp2}) ${datos.telNumResp2}` : '';

    const filaActualizada = [
      numeroDeTurno, new Date(), marcaNE, estadoInscripto, // A-D
      datos.email, datos.nombre, datos.apellido, // E-G
      fechaFormateada, textoGrupo, dniBuscado, // H-J
      datos.obraSocial, datos.colegioJardin, // K-L
      datos.adultoResponsable1, datos.dniResponsable1, telResp1, // M-O
      datos.adultoResponsable2, telResp2, // P-Q
      datos.personasAutorizadas, // R
      datos.practicaDeporte, datos.especifiqueDeporte, datos.tieneEnfermedad, datos.especifiqueEnfermedad, datos.esAlergico, datos.especifiqueAlergia, // S-X
      datos.urlCertificadoAptitud || '', datos.urlFotoCarnet || '', // Y-Z
      datos.jornada, datos.esSocio, // AA-AB
      datos.metodoPago, // AC
      precio, // AD
      '', '', '', parseInt(datos.cantidadCuotas) || 0, // AE-AH
      datos.estadoPago, // AI
      montoAPagar, // AJ
      '', '', '', // AK-AM
      '', '', // AN-AO
      '', // AP
      '', '', '', '', // AQ-AT
      false, // AU
      turnoPrincipal // AV
    ];

    rangoFila.setValues([filaActualizada]);

    aplicarColorGrupo(hojaRegistro, fila, textoGrupo, hojaConfig);
    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    hojaRegistro.getRange(fila, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule);
    hojaRegistro.getRange(fila, COL_VINCULO_PRINCIPAL).setNumberFormat("0");

    SpreadsheetApp.flush();
    obtenerEstadoRegistro();

    return {
      status: 'OK_REGISTRO',
      message: '¡Actualización Exitosa!',
      numeroDeTurno: numeroDeTurno,
      datos: datos,
      hermanosRegistrados: [] 
    };

  } catch (e) {
    Logger.log("ERROR CRÍTICO EN ACTUALIZAR HERMANO: " + e.toString());
    return { status: 'ERROR', message: 'Fallo al actualizar los datos: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function obtenerPrecioDesdeConfig(metodoPago, cantidadCuotas, hojaConfig) {
  let precio;
  let montoAPagar;

  try {
    if (metodoPago === 'Pago en Cuotas') {
      const precioCuota = parseFloat(hojaConfig.getRange("B20").getValue());
      const numCuotas = parseInt(cantidadCuotas) || 3;
      precio = precioCuota * numCuotas; 

      montoAPagar = precio;

    } else {
      precio = parseFloat(hojaConfig.getRange("B14").getValue());
      montoAPagar = precio;
    }

    if (!precio || isNaN(precio)) precio = 0;
    if (!montoAPagar || isNaN(montoAPagar)) montoAPagar = 0;

  } catch (e) {
    Logger.log("Error en obtenerPrecioDesdeConfig: " + e.message);
    precio = 0;
    montoAPagar = 0;
  }

  return { precio, montoAPagar };
}


function paso2_crearPagoYEmail(datos, numeroDeTurno, hermanosRegistrados = null) {
  try {
    const metodo = datos.metodoPago;
    const hermanos = hermanosRegistrados || [];
    const dniRegistrado = datos.dni;

    if (metodo === 'Pago 1 Cuota Deb/Cred MP(Total)') {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
      const pagoTotalHabilitado = hojaConfig.getRange('B22').getValue() === true;

      if (!pagoTotalHabilitado) {
        enviarEmailConfirmacion(datos, numeroDeTurno, null); 
        return {
          status: 'OK_REGISTRO_SIN_LINK',
          message: '¡Registro guardado con éxito! El pago online no está habilitado, contacte a la administración.',
          hermanos: hermanos,
          dniRegistrado: dniRegistrado 
        };
      }

      const init_point = crearPreferenciaDePago(datos, null, 0);

      if (!init_point || !init_point.toString().startsWith('http')) {
        enviarEmailConfirmacion(datos, numeroDeTurno, null);
        return {
          status: 'OK_REGISTRO_SIN_LINK',
          message: `¡Registro guardado! (Turno #${numeroDeTurno}).<br>PERO ocurrió un error al generar su link de pago: ${init_point}. Por favor, contacte a la administración.`,
          hermanos: hermanos,
          dniRegistrado: dniRegistrado
        };
      }

      enviarEmailConfirmacion(datos, numeroDeTurno, init_point);
      return {
        status: 'OK_PAGO', 
        init_point: init_point,
        hermanos: hermanos,
        dniRegistrado: dniRegistrado 
      };

    } else if (metodo === 'Pago en Cuotas') {
      const init_point_c1 = crearPreferenciaDePago(datos, "C1", parseInt(datos.cantidadCuotas) || 3);

      if (!init_point_c1 || !init_point_c1.toString().startsWith('http')) {
        enviarEmailConfirmacion(datos, numeroDeTurno, null);
        return {
          status: 'OK_REGISTRO_SIN_LINK',
          message: `¡Registro guardado! (Turno #${numeroDeTurno}).<br>PERO ocurrió un error al generar el link para la Cuota 1: ${init_point_c1}. Por favor, contacte a la administración.`,
          hermanos: hermanos,
          dniRegistrado: dniRegistrado 
        };
      }

      enviarEmailConfirmacion(datos, numeroDeTurno, { link1: init_point_c1, link2: 'Pendiente', link3: 'Pendiente' });
      return {
        status: 'OK_PAGO',
        init_point: init_point_c1, 
        hermanos: hermanos,
        dniRegistrado: dniRegistrado
      };

    } else if (metodo === 'Pago Efectivo (Adm del Club)' || metodo === 'Transferencia') {
      enviarEmailConfirmacion(datos, numeroDeTurno, null);
      return {
        status: 'OK_EFECTIVO',
        message: `¡Registro guardado con éxito!!.<br>Su método de pago es: <strong>${metodo}</strong>. acérquese a la Secretaría del Club de Martes a Sábados de 11hs a 18hs.`,
        hermanos: hermanos,
        dniRegistrado: dniRegistrado 
      };
    } else {
      enviarEmailConfirmacion(datos, numeroDeTurno, null, 'registro_sin_pago');
      return {
        status: 'OK_EFECTIVO',
        message: `¡Registro guardado con éxito!!.`,
        hermanos: hermanos,
        dniRegistrado: dniRegistrado
      };
    }

  } catch (e) {
    Logger.log("Error fatal en paso2_crearPagoYEmail: " + e.message);
    return {
      status: 'OK_REGISTRO_SIN_LINK',
      message: `¡Registro guardado! (Turno #${numeroDeTurno}).<br>PERO ocurrió un error fatal en el servidor al procesar el pago: ${e.message}.`,
      hermanos: datos.hermanos || [],
      dniRegistrado: datos.dni
    };
  }
}

/**
* (MODIFICADO)
* Añade el 'case' para 'mp_cuota_total' (Cancelación total)
* para que guarde en la columna AQ.
*/
function subirComprobanteManual(dni, fileData, tipoComprobante, datosExtras) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dniLimpio = limpiarDNI(dni);
    if (!dniLimpio || !fileData || !tipoComprobante) {
      return { status: 'ERROR', message: 'Faltan datos (DNI, archivo o tipo de comprobante).' };
    }

    if (!datosExtras || !datosExtras.nombrePagador || !datosExtras.dniPagador) {
      return { status: 'ERROR', message: 'Faltan los datos del adulto pagador (Nombre o DNI).' };
    }
    if (!/^[0-9]{8}$/.test(datosExtras.dniPagador)) {
      return { status: 'ERROR', message: 'El DNI del pagador debe tener 8 dígitos.' };
    }

    const fileUrl = uploadFileToDrive(fileData.data, fileData.mimeType, fileData.fileName, dniLimpio, 'comprobante');
    if (typeof fileUrl !== 'string' || !fileUrl.startsWith('http')) {
      throw new Error("Error al subir el archivo a Drive: " + (fileUrl.message || 'Error desconocido'));
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hoja) throw new Error(`La hoja "${NOMBRE_HOJA_REGISTRO}" no fue encontrada.`);

    const rangoDni = hoja.getRange(2, COL_DNI_INSCRIPTO, hoja.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDni.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) {
      const fila = celdaEncontrada.getRow();
      let columnaDestinoArchivo; 

      hoja.getRange(fila, COL_PAGADOR_NOMBRE_MANUAL).setValue(datosExtras.nombrePagador); // AN (40)
      hoja.getRange(fila, COL_PAGADOR_DNI_MANUAL).setValue(datosExtras.dniPagador); // AO (41)

      switch (tipoComprobante) {
        case 'total_mp':
        case 'mp_total': 
        case 'externo':
        // --- (INICIO DE CORRECCIÓN) ---
        case 'mp_cuota_total': // b.4) Cancelación total
        // --- (FIN DE CORRECCIÓN) ---
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_TOTAL_EXT; // AQ (43)
          break;
        case 'cuota1_mp':
        case 'mp_cuota_1': // b.1) Cuota 1
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA1; // AR (44)
          break;
        case 'cuota2_mp':
        case 'mp_cuota_2': // b.2) Cuota 2
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA2; // AS (45)
          break;
        case 'cuota3_mp':
        case 'mp_cuota_3': // b.3) Cuota 3
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA3; // AT (46)
          break;
        default:
          throw new Error(`Tipo de comprobante no reconocido: ${tipoComprobante}`);
      }

      hoja.getRange(fila, columnaDestinoArchivo).setValue(fileUrl);

      hoja.getRange(fila, COL_ESTADO_PAGO).setValue("En revisión");

      Logger.log(`Comprobante manual [${tipoComprobante}] subido para DNI ${dniLimpio} en fila ${fila}.`);
      return { status: 'OK', message: '¡Comprobante subido con éxito! Será revisado por la administración.' };
    } else {
      Logger.log(`No se encontró DNI ${dniLimpio} para subir comprobante manual.`);
      return { status: 'ERROR', message: `No se encontró el registro para el DNI ${dniLimpio}. Asegúrese de que el DNI del inscripto sea correcto.` };
    }

  } catch (e) {
    Logger.log("Error en subirComprobanteManual: " + e.toString());
    return { status: 'ERROR', message: 'Error en el servidor: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function aplicarColorGrupo(hoja, fila, textoGrupo, hojaConfig) {
  try {
    const rangoGrupos = hojaConfig.getRange("A30:B41");
    const valoresGrupos = rangoGrupos.getValues();
    const coloresGrupos = rangoGrupos.getBackgrounds();

    for (let i = 0; i < valoresGrupos.length; i++) {
      if (valoresGrupos[i][0] == textoGrupo) {
        const color = coloresGrupos[i][1];
        hoja.getRange(fila, COL_GRUPOS).setBackground(color);
        return; 
      }
    }
  } catch (e) {
    Logger.log(`Error al aplicar color para el grupo ${textoGrupo} en fila ${fila}: ${e.message}`);
  }
}

function uploadFileToDrive(data, mimeType, filename, dni, tipoArchivo) {
  try {
    if (!dni) return { status: 'ERROR', message: 'No se recibió DNI.' };
    let parentFolderId;
    switch (tipoArchivo) {
      case 'foto': parentFolderId = FOLDER_ID_FOTOS; break;
      case 'ficha': parentFolderId = FOLDER_ID_FICHAS; break;
      case 'comprobante': parentFolderId = FOLDER_ID_COMPROBANTES; break;
      default: return { status: 'ERROR', message: 'Tipo de archivo no reconocido.' };
    }
    if (!parentFolderId || parentFolderId.includes('AQUI_VA_EL_ID')) {
      return { status: 'ERROR', message: 'IDs de carpetas no configurados.' };
    }

    const parentFolder = DriveApp.getFolderById(parentFolderId);
    let subFolder;
    const folders = parentFolder.getFoldersByName(dni);
    subFolder = folders.hasNext() ? folders.next() : parentFolder.createFolder(dni);

    const decodedData = Utilities.base64Decode(data.split(',')[1]);
    const blob = Utilities.newBlob(decodedData, mimeType, filename);
    const file = subFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();

  } catch (e) {
    Logger.log('Error en uploadFileToDrive: ' + e.toString());
    return { status: 'ERROR', message: 'Error al subir archivo: ' + e.message };
  }
}

function limpiarDNI(dni) {
  if (!dni) return '';
  return String(dni).replace(/[.\s-]/g, '').trim();
}

function calcularEdad(fechaNacimientoStr) {
  if (!fechaNacimientoStr) return { anos: 0, meses: 0, dias: 0 };
  const fechaNacimiento = new Date(fechaNacimientoStr);
  const hoy = new Date();
  fechaNacimiento.setMinutes(fechaNacimiento.getMinutes() + fechaNacimiento.getTimezoneOffset());
  let anos = hoy.getFullYear() - fechaNacimiento.getFullYear();
  let meses = hoy.getMonth() - fechaNacimiento.getMonth();
  let dias = hoy.getDate() - fechaNacimiento.getDate();
  if (dias < 0) {
    meses--;
    dias += new Date(hoy.getFullYear(), hoy.getMonth(), 0).getDate();
  }
  if (meses < 0) {
    anos--;
    meses += 12;
  }
  return { anos, meses, dias };
}

/**
* (CORREGIDO)
* Eliminado 'SpreadsheetApp.flush()' para evitar cuelgues
* en la validación.
*/
function obtenerEstadoRegistro() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hojaConfig) throw new Error(`Hoja "${NOMBRE_HOJA_CONFIG}" no encontrada.`);

    const limiteCupos = parseInt(hojaConfig.getRange('B1').getValue()) || 100;
    const limiteJornadaExtendida = parseInt(hojaConfig.getRange('B4').getValue());
    const formularioAbierto = hojaConfig.getRange('B11').getValue() === true;

    let registrosActuales = 0;
    let registrosJornadaExtendida = 0;

    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      const lastRow = hojaRegistro.getLastRow();

      const rangoTurnos = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1);
      const valoresTurnos = rangoTurnos.getValues();
      registrosActuales = valoresTurnos.filter(fila => fila[0] != null && fila[0] != "").length;

      const data = hojaRegistro.getRange(2, COL_MARCA_N_E_A, lastRow - 1, 1).getValues();
      registrosJornadaExtendida = data.filter(row => String(row[0]).startsWith('Extendida')).length;
    }

    hojaConfig.getRange('B2').setValue(registrosActuales);
    hojaConfig.getRange('B5').setValue(registrosJornadaExtendida);
    // SpreadsheetApp.flush(); // <-- (CORRECCIÓN) ELIMINADO PARA VELOCIDAD

    return {
      alcanzado: registrosActuales >= limiteCupos,
      jornadaExtendidaAlcanzada: registrosJornadaExtendida >= limiteJornadaExtendida,
      cierreManual: !formularioAbierto
    };
  } catch (e) {
    Logger.log("Error en obtenerEstadoRegistro: " + e.message);
    return { cierreManual: true, message: "Error al leer config: " + e.message };
  }
}


/**
* (MODIFICADO)
* Lee la celda B24 y la pasa a 'gestionarUsuarioYaRegistrado'
* y a todos los 'return' de éxito.
*/
function validarAcceso(dni, tipoInscripto) {
  try {
    if (!dni) return { status: 'ERROR', message: 'El DNI no puede estar vacío.' };
    if (!/^[0-9]{8}$/.test(dni.trim())) {
      return { status: 'ERROR', message: 'El DNI debe tener exactamente 8 dígitos numéricos.' };
    }
    const dniLimpio = limpiarDNI(dni);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    if (!hojaConfig) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_CONFIG}" no fue encontrada.` };

    // --- (INICIO DE CORRECCIÓN) ---
    // Leer B22 (para lógica de pago MP) y B24 (para lógica de uploader)
    const pagoTotalHabilitado = hojaConfig.getRange('B22').getValue() === true; // B22
    const pagoTotalMPVisible = hojaConfig.getRange('B24').getValue() === true; // B24
    // --- (FIN DE CORRECCIÓN) ---

    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      const rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      const celdaRegistro = rangoDniRegistro.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

      if (celdaRegistro) {
        const estado = obtenerEstadoRegistro();
        if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };

        // Pasar ambos valores (B22 y B24) a la siguiente función
        return gestionarUsuarioYaRegistrado(ss, hojaRegistro, celdaRegistro.getRow(), dniLimpio, estado, pagoTotalHabilitado, tipoInscripto, pagoTotalMPVisible);
      }
    }

    const estado = obtenerEstadoRegistro();
    if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };

    if (estado.alcanzado && tipoInscripto !== 'preventa') {
      return { status: 'LIMITE_ALCANZADO', message: 'Se ha alcanzado el cupo máximo para nuevos registros.' };
    }

    const hojaPreventa = ss.getSheetByName(NOMBRE_HOJA_PREVENTA);
    if (tipoInscripto === 'preventa') {
      if (!hojaPreventa) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_PREVENTA}" no fue encontrada.` };

      const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
      const celdaEncontrada = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

      if (!celdaEncontrada) {
        return { status: 'ERROR_TIPO_ANT', message: `El DNI ${dniLimpio} no se encuentra en la base de datos de Pre-Venta. Verifique el DNI o seleccione otro tipo de inscripción.` };
      }

      const fila = hojaPreventa.getRange(celdaEncontrada.getRow(), 1, 1, hojaPreventa.getLastColumn()).getValues()[0];
      const jornadaGuarda = String(fila[COL_PREVENTA_GUARDA - 1]).trim().toLowerCase();
      const jornadaPredefinida = (jornadaGuarda.includes('si') || jornadaGuarda.includes('extendida')) ? 'Jornada Normal extendida' : 'Jornada Normal';

      if (jornadaPredefinida === 'Jornada Normal extendida' && estado.jornadaExtendidaAlcanzada) {
        return { status: 'LIMITE_EXTENDIDA', message: 'Su DNI de Pre-Venta corresponde a Jornada Extendida, pero el cupo ya se ha agotado. Por favor, contacte a la administración.' };
      }

      const fechaNacimientoRaw = fila[COL_PREVENTA_FECHA_NAC - 1];
      const fechaNacimientoStr = (fechaNacimientoRaw instanceof Date) ? Utilities.formatDate(fechaNacimientoRaw, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '';

      return {
        status: 'OK_PREVENTA',
        message: '✅ DNI de Pre-Venta validado. Se autocompletarán sus datos. Por favor, complete el resto del formulario.',
        datos: {
          email: fila[COL_PREVENTA_EMAIL - 1],
          nombre: fila[COL_PREVENTA_NOMBRE - 1],
          apellido: fila[COL_PREVENTA_APELLIDO - 1],
          dni: dniLimpio,
          fechaNacimiento: fechaNacimientoStr,
          jornada: jornadaPredefinida,
          esPreventa: true
        },
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        pagoTotalHabilitado: pagoTotalHabilitado,
        pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
      };
    }

    const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);
    if (!hojaBusqueda) return { status: 'ERROR', message: `La hoja "${NOMBRE_HOJA_BUSQUEDA}" no fue encontrada.` };

    const rangoDNI = hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDNI.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) { 
      if (hojaPreventa && hojaPreventa.getLastRow() > 1) {
        const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
        const celdaEncontradaPreventa = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();
        if (celdaEncontradaPreventa) {
          return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
        }
      }

      if (tipoInscripto === 'nuevo') {
        return { status: 'ERROR_TIPO_NUEVO', message: "El DNI se encuentra en nuestra base de datos. Por favor, seleccione 'Soy Inscripto Anterior' y valide nuevamente." };
      }

      const rowIndex = celdaEncontrada.getRow();
      const fila = hojaBusqueda.getRange(rowIndex, COL_HABILITADO_BUSQUEDA, 1, 10).getValues()[0];
      const habilitado = fila[0];
      if (habilitado !== true) {
        return { status: 'NO_HABILITADO', message: 'El DNI se encuentra en la base de datos, pero no está habilitado para la inscripción. Por favor, consulte con la organización.' };
      }

      const nombre = fila[1];
      const apellido = fila[2];
      const fechaNacimientoRaw = fila[3];
      const obraSocial = String(fila[6] || '').trim();
      const colegioJardin = String(fila[7] || '').trim();
      const responsable = String(fila[8] || '').trim();
      const fechaNacimientoStr = (fechaNacimientoRaw instanceof Date) ? Utilities.formatDate(fechaNacimientoRaw, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '';

      return {
        status: 'OK',
        datos: {
          nombre: nombre,
          apellido: apellido,
          dni: dniLimpio,
          fechaNacimiento: fechaNacimientoStr,
          obraSocial: obraSocial,
          colegioJardin: colegioJardin,
          adultoResponsable1: responsable,
          esPreventa: false
        },
        edad: calcularEdad(fechaNacimientoStr),
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        pagoTotalHabilitado: pagoTotalHabilitado,
        pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
      };

    } else { 

      if (hojaPreventa && hojaPreventa.getLastRow() > 1) {
        const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
        const celdaEncontradaPreventa = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();
        if (celdaEncontradaPreventa) {
          return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
        }
      }

      if (tipoInscripto === 'anterior') {
        return { status: 'ERROR_TIPO_ANT', message: "No se encuentra en la base de datos de años anteriores. Por favor, seleccione 'Soy Nuevo Inscripto'." };
      }
      if (tipoInscripto === 'preventa') {
        return { status: 'ERROR_TIPO_ANT', message: `El DNI ${dniLimpio} no se encuentra en la base de datos de Pre-Venta.` };
      }
      return {
        status: 'OK_NUEVO',
        message: '✅ DNI validado. Proceda al registro.',
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        datos: { dni: dniLimpio, esPreventa: false },
        pagoTotalHabilitado: pagoTotalHabilitado,
        pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
      };
    }

  } catch (e) {
    Logger.log("Error en validarAcceso: " + e.message + " Stack: " + e.stack);
    return { status: 'ERROR', message: 'Ocurrió un error al validar el DNI. ' + e.message };
  }
}


/**
* (MODIFICADO)
* Acepta 'pagoTotalMPVisible' (B24) y lo pasa al 'return'.
* Arreglado el typo 'REGISTTIPO_ENCONTRADO'.
*/
function gestionarUsuarioYaRegistrado(ss, hojaRegistro, filaRegistro, dniLimpio, estado, pagoTotalHabilitado, tipoInscripto, pagoTotalMPVisible) { // <-- Acepta B24
  const rangoFila = hojaRegistro.getRange(filaRegistro, 1, 1, hojaRegistro.getLastColumn()).getValues()[0];

  const estadoPago = rangoFila[COL_ESTADO_PAGO - 1];
  const metodoPago = rangoFila[COL_METODO_PAGO - 1];
  const nombreRegistrado = rangoFila[COL_NOMBRE - 1] + ' ' + rangoFila[COL_APELLIDO - 1];
  const estadoInscripto = rangoFila[COL_ESTADO_NUEVO_ANT - 1];

  const estadoInscriptoTrim = estadoInscripto ? String(estadoInscripto).trim() : "";

  if (estadoInscriptoTrim.toLowerCase().includes('hermano/a') && !metodoPago) { 
    const estadoTrimLower = estadoInscriptoTrim.toLowerCase();

    if (estadoTrimLower.includes('nuevo') && tipoInscripto !== 'nuevo') {
      return { status: 'ERROR', message: 'Usted está registrado como "Nuevo Hermano/a". Por favor, seleccione "Soy Nuevo Inscripto" para validar.' };
    }
    if (estadoTrimLower.includes('anterior') && tipoInscripto !== 'anterior') {
      return { status: 'ERROR', message: 'Usted está registrado como "Anterior Hermano/a". Por favor, seleccione "Soy Inscripto Anterior" para validar.' };
    }
    if (estadoTrimLower.includes('pre-venta') && tipoInscripto !== 'preventa') {
      return { status: 'ERROR', message: 'Usted está registrado como "Pre-venta Hermano/a". Por favor, seleccione "Soy Inscripto PRE-VENTA" para validar.' };
    }

    let faltantes = [];
    if (!rangoFila[COL_COLEGIO_JARDIN - 1]) faltantes.push('Colegio / Jardín');
    if (!rangoFila[COL_PRACTICA_DEPORTE - 1]) faltantes.push('Practica Deporte');
    if (!rangoFila[COL_TIENE_ENFERMEDAD - 1]) faltantes.push('Enfermedad Preexistente');
    if (!rangoFila[COL_ES_ALERGICO - 1]) faltantes.push('Alergias');
    if (!rangoFila[COL_FOTO_CARNET - 1]) faltantes.push('Foto Carnet 4x4');
    if (!rangoFila[COL_JORNADA - 1]) faltantes.push('Jornada');
    if (!rangoFila[COL_SOCIO - 1]) faltantes.push('Es Socio'); 
    if (!rangoFila[COL_METODO_PAGO - 1]) faltantes.push('Método de Pago');

    if (!rangoFila[COL_EMAIL - 1]) faltantes.push('Email');
    if (!rangoFila[COL_ADULTO_RESPONSABLE_1 - 1]) faltantes.push('Responsable 1');
    if (!rangoFila[COL_PERSONAS_AUTORIZADAS - 1]) faltantes.push('Personas Autorizadas');

    const datos = {
      dni: dniLimpio,
      nombre: rangoFila[COL_NOMBRE - 1],
      apellido: rangoFila[COL_APELLIDO - 1],
      fechaNacimiento: rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1] ? Utilities.formatDate(new Date(rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1]), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '',

      email: rangoFila[COL_EMAIL - 1] || '',
      adultoResponsable1: rangoFila[COL_ADULTO_RESPONSABLE_1 - 1] || '',
      dniResponsable1: rangoFila[COL_DNI_RESPONSABLE_1 - 1] || '',
      telResponsable1: rangoFila[COL_TEL_RESPONSABLE_1 - 1] || '',
      adultoResponsable2: rangoFila[COL_ADULTO_RESPONSABLE_2 - 1] || '',
      telResponsable2: rangoFila[COL_TEL_RESPONSABLE_2 - 1] || '',
      personasAutorizadas: rangoFila[COL_PERSONAS_AUTORIZADAS - 1] || '',
      obraSocial: rangoFila[COL_OBRA_SOCIAL - 1] || '',

      colegioJardin: rangoFila[COL_COLEGIO_JARDIN - 1] || ''
    };

    return {
      status: 'HERMANO_COMPLETAR',
      message: `⚠️ ¡Hola ${datos.nombre}! Eres un hermano/a pre-registrado.\n` +
      `Por favor, complete/verifique TODOS los campos del formulario para obtener el cupo definitivo y el link para pagar.\n` +
      (faltantes.length > 0 ? `Campos requeridos faltantes detectados: <strong>${faltantes.join(', ')}</strong>.` : 'Todos los campos parecen estar listos para verificar.'),
      datos: datos,
      jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
      tipoInscripto: estadoInscripto,
      pagoTotalHabilitado: pagoTotalHabilitado,
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  }

  const aptitudFisica = rangoFila[COL_APTITUD_FISICA - 1];
  const adeudaAptitud = !aptitudFisica;
  const cantidadCuotasRegistrada = parseInt(rangoFila[COL_CANTIDAD_CUOTAS - 1]) || 0;
  let proximaCuotaPendiente = null;

  if (String(estadoPago).includes('Pagado')) {
    return {
      status: 'REGISTRO_ENCONTRADO',
      message:  `✅ El DNI  ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO y la inscripción está PAGADA.`,
      adeudaAptitud: adeudaAptitud,
      cantidadCuotas: cantidadCuotasRegistrada,
      metodoPago: metodoPago,
      proximaCuotaPendiente: null,
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  }

  if (String(estadoPago).includes('En revisión')) {
    return {
      status: 'REGISTRO_ENCONTRADO',
      message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. Su pago está "En revisión".`,
      adeudaAptitud: adeudaAptitud,
      cantidadCuotas: cantidadCuotasRegistrada,
      metodoPago: metodoPago,
      proximaCuotaPendiente: null,
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  }

  // ===============================================
  // --- ¡¡INICIO DE LA CORRECCIÓN!! ---
  // ===============================================

  if (String(metodoPago).includes('Efectivo') || String(metodoPago).includes('Transferencia')) {
    return {
      // --- ¡¡EL TYPO ESTABA AQUÍ!! ---
      status: 'REGISTRO_ENCONTRADO', // Corregido de 'REGISTTIPO_ENCONTRADO'
      // ---------------------------------
      message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. El pago (${metodoPago}) está PENDIENTE.`,
      adeudaAptitud: adeudaAptitud,
      cantidadCuotas: cantidadCuotasRegistrada,
      metodoPago: metodoPago,
      proximaCuotaPendiente: 'subir_comprobante_manual',
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  }

  // ===============================================
  // --- ¡¡FIN DE LA CORRECCIÓN!! ---
  // ===============================================

  try {
    const datosParaPago = {
      dni: dniLimpio,
      apellidoNombre: nombreRegistrado,
      email: rangoFila[COL_EMAIL - 1],
      metodoPago: metodoPago,
      jornada: rangoFila[COL_JORNADA - 1]
    };
    let identificadorPago = null;
    if (metodoPago === 'Pago en Cuotas') {
      for (let i = 1; i <= cantidadCuotasRegistrada; i++) {
        let colCuota = i === 1 ? COL_CUOTA_1 : (i === 2 ? COL_CUOTA_2 : COL_CUOTA_3);
        let cuota_status = rangoFila[colCuota - 1];
        if (!cuota_status || (!cuota_status.toString().includes("Pagada") && !cuota_status.toString().includes("Notificada"))) {
          identificadorPago = `C${i}`;
          proximaCuotaPendiente = identificadorPago;
          break;
        }
      }
      if (identificadorPago == null) {
        return {
          status: 'REGISTRO_ENCONTRADO',
          message:  `✅ El DNI  ${dniLimpio} (${nombreRegistrado}) ya completó todas las cuotas.`,
          adeudaAptitud: adeudaAptitud,
          cantidadCuotas: cantidadCuotasRegistrada,
          metodoPago: metodoPago,
          proximaCuotaPendiente: null,
          pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
        };
      }
    } else if (metodoPago === 'Pago 1 Cuota Deb/Cred MP(Total)') {
      if (pagoTotalHabilitado === false) {
        return {
          status: 'REGISTRO_ENCONTRADO',
          message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya está REGISTRADO. El pago (${metodoPago}) está PENDIENTE, pero la opción de pago online está desactivada.`,
          adeudaAptitud: adeudaAptitud,
          cantidadCuotas: cantidadCuotasRegistrada,
          metodoPago: metodoPago,
          proximaCuotaPendiente: null,
          pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
        };
      }
    }

    const init_point = crearPreferenciaDePago(datosParaPago, identificadorPago, cantidadCuotasRegistrada);

    if (!init_point || !init_point.toString().startsWith('http')) {
      return {
        status: 'REGISTRO_ENCONTRADO',
        message: `⚠️ Error al generar link: ${init_point}`,
        adeudaAptitud: adeudaAptitud,
        cantidadCuotas: cantidadCuotasRegistrada,
        metodoPago: metodoPago,
        proximaCuotaPendiente: proximaCuotaPendiente,
        error_init_point: init_point,
        pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
      };
    }

    return {
      status: 'REGISTRO_ENCONTRADO',
      message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. Se generó un link para la próxima cuota pendiente (${identificadorPago || 'Pago Total'}).`,
      init_point: init_point,
      adeudaAptitud: adeudaAptitud,
      cantidadCuotas: cantidadCuotasRegistrada,
      metodoPago: metodoPago,
      proximaCuotaPendiente: proximaCuotaPendiente,
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  } catch (e) {
    Logger.log(`Error al generar link de repago para DNI ${dniLimpio}: ${e.message}`);
    return {
      status: 'REGISTRO_ENCONTRADO',
      message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya está REGISTRADO. Pago PENDIENTE, pero error al generar link: ${e.message}`,
      adeudaAptitud: adeudaAptitud,
      cantidadCuotas: cantidadCuotasRegistrada,
      metodoPago: metodoPago,
      proximaCuotaPendiente: proximaCuotaPendiente,
      error_init_point: e.message,
      pagoTotalMPVisible: pagoTotalMPVisible // <-- Añadido B24
    };
  }
}


function enviarEmailConfirmacion(datos, numeroDeTurno, init_point = null, overrideMetodo = null) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);

    if (!hojaConfig || !datos.email || hojaConfig.getRange('B8').getValue() !== true) {
      Logger.log("Envío de email deshabilitado o sin email.");
      return;
    }

    let asunto = "";
    let cuerpoOriginal = "";
    let cuerpoFinal = "";
    const metodo = overrideMetodo || datos.metodoPago;

    const nombreCompleto = `${datos.nombre} ${datos.apellido}`;

    if (metodo === 'Pago 1 Cuota Deb/Cred MP(Total)') {
      asunto = hojaConfig.getRange('E2:G2').getValue();
      cuerpoOriginal = hojaConfig.getRange('D4:H8').getValue();
      if (!asunto) asunto = "Confirmación de Registro (Pago Total)";
      if (!cuerpoOriginal) cuerpoOriginal = "Su cupo ha sido reservado.\n\nInscripto: {{nombreCompleto}}\nTurno: {{numeroDeTurno}}\n\nLink de Pago: {{linkDePago}}";

      cuerpoFinal = cuerpoOriginal
        .replace(/{{nombreCompleto}}/g, nombreCompleto)
        .replace(/{{numeroDeTurno}}/g, numeroDeTurno)
        .replace(/{{linkDePago}}/g, init_point || 'N/A');

    } else if (metodo === 'Pago Efectivo (Adm del Club)' || metodo === 'registro_sin_pago') {
      asunto = hojaConfig.getRange('E13:H13').getValue();
      cuerpoOriginal = hojaConfig.getRange('D15:H19').getValue();
      if (!asunto) asunto = "Confirmación de Registro (Pago Efectivo)";
      if (!cuerpoOriginal) cuerpoOriginal = "Su cupo ha sido reservado.\n\nInscripto: {{nombreCompleto}}\nTurno: {{numeroDeTurno}}\n\nPor favor, acérquese a la administración.";

      cuerpoFinal = cuerpoOriginal
        .replace(/{{nombreCompleto}}/g, nombreCompleto)
        .replace(/{{numeroDeTurno}}/g, numeroDeTurno);

    } else if (metodo === 'Transferencia') {
      asunto = "Confirmación de Registro (Transferencia)"; 
      cuerpoOriginal = "Su cupo ha sido reservado.\n\nInscripto: {{nombreCompleto}}\nTurno: {{numeroDeTurno}}\n\n" +
        "Por favor, realice la transferencia a:\n" +
        "TITULAR DE LA CUENTA: Walter Jonas Marrello\n" +
        "Alias: clubhipicomendoza\n\n" +
        "IMPORTANTE: Una vez realizada, vuelva a ingresar al formulario con su DNI para subir el comprobante.";

      cuerpoFinal = cuerpoOriginal
        .replace(/{{nombreCompleto}}/g, nombreCompleto)
        .replace(/{{numeroDeTurno}}/g, numeroDeTurno);

    } else if (metodo === 'Pago en Cuotas') {
      asunto = hojaConfig.getRange('E24:G24').getValue();
      cuerpoOriginal = hojaConfig.getRange('D26:H30').getValue();
      if (!asunto) asunto = "Confirmación de Registro (Cuotas)";
      if (!cuerpoOriginal) cuerpoOriginal = "Su cupo ha sido reservado.\n\nInscripto: {{nombreCompleto}}\nTurno: {{numeroDeTurno}}\n\nLink Cuota 1: {{linkCuota1}}\nLink Cuota 2: {{linkCuota2}}\nLink Cuota 3: {{linkCuota3}}";

      cuerpoFinal = cuerpoOriginal
        .replace(/{{nombreCompleto}}/g, nombreCompleto)
        .replace(/{{numeroDeTurno}}/g, numeroDeTurno)
        .replace(/{{linkCuota1}}/g, (init_point && init_point.link1) ? init_point.link1 : 'Error al generar')
        .replace(/{{linkCuota2}}/g, (init_point && init_point.link2) ? init_point.link2 : 'Error al generar')
        .replace(/{{linkCuota3}}/g, (init_point && init_point.link3) ? init_point.link3 : 'Error al generar');

    } else {
      Logger.log(`Método de pago "${datos.metodoPago}" no reconocido para email.`);
      return;
    }

    /*
    MailApp.sendEmail({
    to: datos.email,
    subject: `${asunto} (Turno #${numeroDeTurno})`,
    body: cuerpoFinal
    });

    Logger.log(`Correo enviado a ${datos.email} por ${datos.metodoPago}.`);
    */
    Logger.log(`(Punto 29) Envío de email automático a ${datos.email} DESACTIVADO.`);

  } catch (e) {
    Logger.log("Error al enviar correo (enviarEmailConfirmacion): " + e.message);
  }
}

function subirAptitudManual(dni, fileData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dniLimpio = limpiarDNI(dni);
    if (!dniLimpio || !fileData) {
      return { status: 'ERROR', message: 'Faltan datos (DNI o archivo).' };
    }

    const fileUrl = uploadFileToDrive(fileData.data, fileData.mimeType, fileData.fileName, dniLimpio, 'ficha');
    if (typeof fileUrl !== 'string' || !fileUrl.startsWith('http')) {
      throw new Error("Error al subir el archivo a Drive.");
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hoja = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (!hoja) throw new Error(`La hoja "${NOMBRE_HOJA_REGISTRO}" no fue encontrada.`);

    const rangoDni = hoja.getRange(2, COL_DNI_INSCRIPTO, hoja.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDni.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) {
      const fila = celdaEncontrada.getRow();
      hoja.getRange(fila, COL_APTITUD_FISICA).setValue(fileUrl);

      Logger.log(`Aptitud Física subida para DNI ${dniLimpio} en fila ${fila}.`);
      return { status: 'OK', message: '¡Certificado de Aptitud subido con éxito!' };
    } else {
      Logger.log(`No se encontró DNI ${dniLimpio} para subir aptitud física.`);
      return { status: 'ERROR', message: `No se encontró el registro para el DNI ${dniLimpio}.` };
    }

  } catch (e) {
    Logger.log("Error en subirAptitudManual: " + e.toString());
    return { status: 'ERROR', message: 'Error en el servidor: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

function sincronizarRegistros() {
  Logger.log("sincronizarRegistros: Función omitida.");
  return;
}

function subirArchivoIndividual(fileData, dni, tipoArchivo) {
  try {
    if (!fileData || !dni || !tipoArchivo) {
      return { status: 'ERROR', message: 'Faltan datos para la subida (DNI, archivo o tipo).' };
    }

    const dniLimpio = limpiarDNI(dni);

    const fileUrl = uploadFileToDrive(
      fileData.data,
      fileData.mimeType,
      fileData.fileName,
      dniLimpio,
      tipoArchivo
    );

    if (typeof fileUrl === 'object' && fileUrl.status === 'ERROR') {
      return fileUrl;
    }

    return { status: 'OK', url: fileUrl };

  } catch (e) {
    Logger.log("Error en subirArchivoIndividual: " + e.toString());
    return { status: 'ERROR', message: 'Error del servidor al subir: ' + e.message };
  }
}