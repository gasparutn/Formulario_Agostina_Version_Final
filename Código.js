// =========================================================
// codigo.gs (COMPLETO Y CORREGIDO)
// =========================================================

/**
 * *** ¡¡MODIFICADO!! ***
 * Llama a handleMPRedirect (en PagosMP.gs) si detecta un pago.
 * De lo contrario, carga el formulario.
 */
function doGet(e) {
  try {
    const params = e.parameter;
    Logger.log("doGet INICIADO. Parámetros de URL: " + JSON.stringify(params));

    const appUrl = ScriptApp.getService().getUrl();

    if (params.status === 'failure') {
      Logger.log("doGet detectó 'status=failure'. Redirigiendo al formulario.");
      // Cae en el "CAMINO 2"
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

      // --- CAMINO 1: Se detectó un pago (Redirect de Mercado Pago) ---
      if (paymentId) {
        // --- ¡¡MODIFICACIÓN!! ---
        // Llama a la función dedicada en PagosMP.gs
        return handleMPRedirect(params, appUrl);
      }
    }

    // --- CAMINO 2: Visita normal al formulario (o 'status=failure') ---
    const htmlTemplate = HtmlService.createTemplateFromFile('Index');
    htmlTemplate.appUrl = appUrl;
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

// =========================================================
/**
 * (doPost - Webhook)
 * *** ¡¡MODIFICADO!! ***
 * Pasa el control a handleMPWebhook (en PagosMP.gs).
 */
// =========================================================
function doPost(e) {
  // --- ¡¡MODIFICACIÓN!! ---
  // Llama a la función dedicada en PagosMP.gs
  return handleMPWebhook(e);
}

// =========================================================
// (MODIFICADO) registrarDatos (ACTUALIZADO - PUNTO 34, Anti-Duplicados y Punto 38)
// =========================================================
/**
 * Guarda los datos finales en la hoja "Registros" (48 COLUMNAS)
 */
function registrarDatos(datos) {
  Logger.log("REGISTRAR DATOS INICIADO. Datos: " + JSON.stringify(datos));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);

    // --- (INICIO MODIFICACIÓN PUNTO 38) ---
    // Validación de Fecha de Nacimiento (Servidor)
    const fechaNacPrincipal = datos.fechaNacimiento;
    if (!fechaNacPrincipal || fechaNacPrincipal < "2010-01-01" || fechaNacPrincipal > "2023-12-31") {
       return { status: 'ERROR', message: 'La fecha de nacimiento del inscripto principal debe estar entre 01/01/2010 y 31/12/2023.' };
    }
    // --- (FIN MODIFICACIÓN PUNTO 38) ---

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    let estadoActual = obtenerEstadoRegistro();

    if (estadoActual.cierreManual) return { status: 'CERRADO', message: 'El registro se encuentra cerrado.' };
    // (Punto 25) La validación de cupo para Pre-Venta ya se hizo en validarAcceso
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

    // =========================================================
    // (VALIDACIÓN ANTI-DUPLICADOS - PRINCIPAL)
    // =========================================================
    if (rangoDniRegistro) {
      const celdaRegistro = rangoDniRegistro.createTextFinder(dniBuscado).matchEntireCell(true).findNext();
      if (celdaRegistro) {
        Logger.log(`BLOQUEO DE REGISTRO: El DNI ${dniBuscado} ya existe en la fila ${celdaRegistro.getRow()}.`);
        // Usamos status 'ERROR' para que el frontend muestre el mensaje en rojo.
        return { status: 'ERROR', message: `El DNI ${dniBuscado} ya se encuentra registrado. No se puede crear un duplicado.` };
      }
    }
    // =========================================================
    // (FIN DE LA VALIDACIÓN)
    // =========================================================

    if (!hojaRegistro) {
      hojaRegistro = ss.insertSheet(NOMBRE_HOJA_REGISTRO);
      // --- (¡¡¡ENCABEZADOS ACTUALIZADOS - PUNTO 34!!!) ---
      hojaRegistro.appendRow([
        'N° de Turno', 'Marca temporal', 'Marca N/E', 'Estado', // A-D
        'Email', 'Nombre', 'Apellido', // E-G (Punto 2)
        'Fecha de Nacimiento', 'GRUPOS', 'DNI', // H-J (¡¡¡COLUMNA 'I' RENOMBRADA!!!)
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
        'Turno Principal' // AV (NUEVA - PUNTO 34)
      ]);
      // Si la hoja es nueva, el rango de DNIs debe ser re-evaluado (o será null)
      rangoDniRegistro = null;
    }

    // --- CÁLCULO DE PRECIOS ---
    // Llama a la función que se quedó en Pagos.js
    const { precio, montoAPagar } = obtenerPrecioDesdeConfig(datos.metodoPago, datos.cantidadCuotas, hojaConfig);


    // --- REGISTRO DEL INSCRIPTO PRINCIPAL ---

    const lastRow = hojaRegistro.getLastRow();
    let ultimoTurno = 0;
    if (lastRow > 1) {
      const rangoTurnos = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1).getValues();
      const turnosReales = rangoTurnos.map(f => f[0]).filter(Number);
      if (turnosReales.length > 0) {
        ultimoTurno = Math.max(...turnosReales);
      } else {
        ultimoTurno = 0;
      }
    } else {
      ultimoTurno = 0;
    }
    const nuevoNumeroDeTurno = ultimoTurno + 1;


    // (MODIFICACIÓN) Cálculo de Edad (para el grupo)
    const edadCalculada = calcularEdad(datos.fechaNacimiento);
    // const edadFormateada = `${edadCalculada.anos}a, ${edadCalculada.meses}m, ${edadCalculada.dias}d`; // ¡¡¡ELIMINADO!!!
    const textoGrupo = `GRUPO ${edadCalculada.anos} AÑOS`; // ¡¡¡NUEVO!!!

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

    // (MODIFICACIÓN - PUNTO 34) appendRow actualizado para 48 columnas
    const filaNueva = [
      nuevoNumeroDeTurno, new Date(), marcaNE, estadoInscripto, // A-D
      datos.email, datos.nombre, datos.apellido, // E-G
      fechaFormateada, textoGrupo, dniBuscado, // H-J (¡¡¡MODIFICADO!!!)
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
      '', '', '', // AK-AM (IDs de Pago MP, etc)
      '', '', // AN-AO (NUEVAS - Pagador Manual)
      '', // AP (Comprobante MP)
      '', '', '', '', // AQ-AT (Nuevos Comprobantes Manuales)
      false, // AU (Checkbox)
      nuevoNumeroDeTurno // AV (NUEVA - PUNTO 34)
    ];
    hojaRegistro.appendRow(filaNueva);
    const filaInsertada = hojaRegistro.getLastRow(); // Obtener la fila recién insertada

    // (¡¡¡NUEVO!!!) Actualizar el rango de DNIs para que incluya la fila que acabamos de agregar
    // Esto es crucial para que el chequeo de hermanos no falle si la hoja estaba vacía
    if (rangoDniRegistro == null) {
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    }


    // (¡¡¡NUEVO!!!) Aplicar color al grupo
    aplicarColorGrupo(hojaRegistro, filaInsertada, textoGrupo, hojaConfig);

    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    hojaRegistro.getRange(filaInsertada, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule); // (Punto 17, 27) Columna AU
    hojaRegistro.getRange(filaInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0"); // (PUNTO 34)

    // --- (Punto 5, 11) REGISTRO DE HERMANOS (Validación Anti-Duplicados Añadida) ---
    if (datos.hermanos && datos.hermanos.length > 0) {
      const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);

      // (INICIO VALIDACIÓN DUPLICADOS)
      // Recargamos el rango de DNIs por si acaso (aunque ya debería estar bien)
      rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      let dnisHermanosEnEsteLote = new Set();
      // (FIN VALIDACIÓN DUPLICADOS)

      let proximoTurnoHermano = nuevoNumeroDeTurno;

      for (const hermano of datos.hermanos) {
        proximoTurnoHermano++;

        const dniHermano = limpiarDNI(hermano.dni);
        if (!dniHermano || !hermano.nombre || !hermano.apellido || !hermano.fechaNac) continue;

        // --- (INICIO MODIFICACIÓN PUNTO 38) ---
        // Validación de Fecha de Nacimiento para Hermanos (Servidor)
        if (hermano.fechaNac < "2010-01-01" || hermano.fechaNac > "2023-12-31") {
           return { status: 'ERROR', message: `La fecha de nacimiento del hermano/a (${hermano.nombre}) debe estar entre 01/01/2010 y 31/12/2023.` };
        }
        // --- (FIN MODIFICACIÓN PUNTO 38) ---


        // =========================================================
        // (VALIDACIÓN ANTI-DUPLICADOS - HERMANOS)
        // =========================================================
        // 1. Chequear contra el principal
        if (dniHermano === dniBuscado) {
          Logger.log(`BLOQUEO DE REGISTRO: El DNI de hermano ${dniHermano} es igual al DNI principal.`);
          return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}) no puede ser igual al del inscripto principal.` };
        }
        // 2. Chequear contra otros hermanos en el mismo formulario
        if (dnisHermanosEnEsteLote.has(dniHermano)) {
          Logger.log(`BLOQUEO DE REGISTRO: El DNI de hermano ${dniHermano} está duplicado en el formulario.`);
          return { status: 'ERROR', message: `El DNI ${dniHermano} está repetido entre los hermanos. Por favor, revise los datos.` };
        }
        dnisHermanosEnEsteLote.add(dniHermano);
        // 3. Chequear contra la hoja de Registros (incluyendo al principal que acabamos de agregar)
        const celdaRegistroHermano = rangoDniRegistro.createTextFinder(dniHermano).matchEntireCell(true).findNext();
        if (celdaRegistroHermano) {
          Logger.log(`BLOQUEO DE REGISTRO: El DNI de hermano ${dniHermano} ya existe en la fila ${celdaRegistroHermano.getRow()}.`);
          // (INICIO CORRECCIÓN DE SINTAXIS)
          return { status: 'ERROR', message: `El DNI del hermano/a (${hermano.nombre}: ${dniHermano}) ya se encuentra registrado. No se puede crear un duplicado.` };
          // (FIN CORRECCIÓN DE SINTAXIS)
        }
        // =========================================================
        // (FIN DE LA VALIDACIÓN)
        // =========================================================

        let estadoHermano = "Nuevo Hermano/a";
        if (hojaBusqueda && hojaBusqueda.getLastRow() > 1) {
          const rangoDNI = hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1);
          const celdaEncontrada = rangoDNI.createTextFinder(dniHermano).matchEntireCell(true).findNext();
          if (celdaEncontrada) {
            estadoHermano = "Anterior Hermano/a";
          }
        }

        // (MODIFICACIÓN) Cálculo de Edad y Grupo para Hermano
        const edadCalcHermano = calcularEdad(hermano.fechaNac);
        // const edadFmtHermano = `${edadCalcHermano.anos}a, ${edadCalcHermano.meses}m, ${edadCalcHermano.dias}d`; // ¡¡¡ELIMINADO!!!
        const textoGrupoHermano = `GRUPO ${edadCalcHermano.anos} AÑOS`; // ¡¡¡NUEVO!!!
        const fechaObjHermano = new Date(hermano.fechaNac);
        const fechaFmtHermano = Utilities.formatDate(fechaObjHermano, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');

        // (MODIFICACIÓN - PUNTO 34) Fila de hermano actualizada a 48 columnas
        const filaHermano = [
          proximoTurnoHermano, new Date(), '', estadoHermano, // A-D
          datos.email, hermano.nombre, hermano.apellido, // E-G
          fechaFmtHermano, textoGrupoHermano, dniHermano, // H-J (¡¡¡MODIFICADO!!!)
          datos.obraSocial, '', // K-L
          datos.adultoResponsable1, datos.dniResponsable1, telResp1, // M-O
          datos.adultoResponsable2, telResp2, // P-Q
          datos.personasAutorizadas, // R
          '', '', '', '', '', '', // S-X (Salud VACÍO)
          '', '', // Y-Z (Aptitud, Foto VACÍOS)
          '', '', // AA-AB (Jornada, SOCIO VACÍOS)
          '', // AC (Método Pago VACÍO)
          0, // AD (Precio)
          '', '', '', 0, // AE-AH (Cuotas)
          'Pendiente (Hermano)', // AI (Estado de Pago)
          0, // AJ (Monto a Pagar)
          '', '', '', // AK-AM
          '', '', // AN-AO
          '', // AP
          '', '', '', '', // AQ-AT
          false, // AU
          nuevoNumeroDeTurno // AV (NUEVA - PUNTO 34)
        ];
        hojaRegistro.appendRow(filaHermano);
        const filaHermanoInsertada = hojaRegistro.getLastRow();

        // (¡¡¡NUEVO!!!) Aplicar color al grupo del hermano
        aplicarColorGrupo(hojaRegistro, filaHermanoInsertada, textoGrupoHermano, hojaConfig);

        hojaRegistro.getRange(filaHermanoInsertada, COL_ENVIAR_EMAIL_MANUAL).setDataValidation(rule); // (Punto 17, 27) Columna AU
        hojaRegistro.getRange(filaHermanoInsertada, COL_VINCULO_PRINCIPAL).setNumberFormat("0"); // (PUNTO 34)

        // (¡¡¡IMPORTANTE!!!) Actualizar el rango de DNIs para el siguiente loop de hermano
        rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      }
    }

    SpreadsheetApp.flush();
    obtenerEstadoRegistro(); // Actualiza el contador de cupos

    // Devolver solo los datos del inscripto principal
    return { status: 'OK_REGISTRO', message: '¡Registro Exitoso!', numeroDeTurno: nuevoNumeroDeTurno, datos: datos };

  } catch (e) {
    Logger.log("ERROR CRÍTICO EN REGISTRO: " + e.toString());
    return { status: 'ERROR', message: 'Fallo al registrar los datos: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}
// =========================================================
// (Punto 15, 17, 19, 27) subirComprobanteManual (ACTUALIZADO)
// =========================================================
/**
 * Sube un comprobante manual a Drive y actualiza la hoja
 * @param {string} dni DNI del inscripto (para buscar la fila)
 * @param {object} fileData Objeto con {data, mimeType, fileName}
 * @param {string} tipoComprobante 'total_mp', 'cuota1_mp', 'cuota2_mp', 'cuota3_mp', 'externo'
 * @param {object} datosExtras {nombrePagador, dniPagador} (del mini-form)
 */
function subirComprobanteManual(dni, fileData, tipoComprobante, datosExtras) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const dniLimpio = limpiarDNI(dni);
    if (!dniLimpio || !fileData || !tipoComprobante) {
      return { status: 'ERROR', message: 'Faltan datos (DNI, archivo o tipo de comprobante).' };
    }

    // Validar que los datos del pagador (datosExtras) llegaron
    // (Validación DNI Punto 35)
    if (!datosExtras || !datosExtras.nombrePagador || !datosExtras.dniPagador) {
      return { status: 'ERROR', message: 'Faltan los datos del adulto pagador (Nombre o DNI).' };
    }
    if (!/^[0-9]{8}$/.test(datosExtras.dniPagador)) {
      return { status: 'ERROR', message: 'El DNI del pagador debe tener 8 dígitos.' };
    }

    // Usar el DNI del inscripto para la carpeta
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
      let columnaDestinoArchivo; // Columna para el LINK

      // --- ¡NUEVA LÓGICA! ---
      // 1. Guardar los datos del pagador en sus columnas (AN y AO - DESPLAZADAS)
      hoja.getRange(fila, COL_PAGADOR_NOMBRE_MANUAL).setValue(datosExtras.nombrePagador); // AN (40)
      hoja.getRange(fila, COL_PAGADOR_DNI_MANUAL).setValue(datosExtras.dniPagador); // AO (41)

      // 2. Asignar la columna de destino para el LINK DEL ARCHIVO (COLUMNAS DESPLAZADAS)
      switch (tipoComprobante) {
        case 'total_mp':
        case 'mp_total': // Alias de Index.html
        case 'externo':
          // ¡ESTA ES TU PETICIÓN! Opción 'a' va a la columna AQ
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_TOTAL_EXT; // AQ (43)
          break;
        case 'cuota1_mp':
        case 'mp_cuota_1': // Alias de Index.html
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA1; // AR (44)
          break;
        case 'cuota2_mp':
        case 'mp_cuota_2': // Alias de Index.html
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA2; // AS (45)
          break;
        case 'cuota3_mp':
        case 'mp_cuota_3': // Alias de Index.html
          columnaDestinoArchivo = COL_COMPROBANTE_MANUAL_CUOTA3; // AT (46)
          break;
        default:
          throw new Error(`Tipo de comprobante no reconocido: ${tipoComprobante}`);
      }

      // 3. Guardar SOLO el link en la columna de archivo correspondiente
      hoja.getRange(fila, columnaDestinoArchivo).setValue(fileUrl);

      // 4. Actualizar estado
      hoja.getRange(fila, COL_ESTADO_PAGO).setValue("En revisión");

      Logger.log(`Comprobante manual [${tipoComprobante}] subido para DNI ${dniLimpio} en fila ${fila}.`);
      return { status: 'OK', message: '¡Comprobante subido con éxito! Será revisado por la administración.' };
    } else {
      Logger.log(`No se encontró DNI ${dniLimpio} para subir comprobante manual.`);
      // (INICIO CORRECCIÓN DE SINTAXIS)
      return { status: 'ERROR', message: `No se encontró el registro para el DNI ${dniLimpio}. Asegúrese de que el DNI del inscripto sea correcto.` };
      // (FIN CORRECCIÓN DE SINTAXIS)
    }

  } catch (e) {
    Logger.log("Error en subirComprobanteManual: " + e.toString());
    return { status: 'ERROR', message: 'Error en el servidor: ' + e.message };
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// (¡¡¡NUEVA FUNCIÓN HELPER!!!)
// =========================================================
/**
 * Aplica el color de fondo a la celda del GRUPO según la hoja de Config.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hoja La hoja "Registros".
 * @param {number} fila El número de fila a colorear.
 * @param {string} textoGrupo El texto del grupo (ej. "GRUPO 4 AÑOS").
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hojaConfig La hoja "Config".
 */
function aplicarColorGrupo(hoja, fila, textoGrupo, hojaConfig) {
  try {
    // Rango A30:B41 (12 filas, 2 columnas)
    const rangoGrupos = hojaConfig.getRange("A30:B41");
    const valoresGrupos = rangoGrupos.getValues();
    const coloresGrupos = rangoGrupos.getBackgrounds();

    for (let i = 0; i < valoresGrupos.length; i++) {
      // Compara el texto de la Col A (ej. "GRUPO 4 AÑOS")
      if (valoresGrupos[i][0] == textoGrupo) {
        // Obtiene el color de la Col B (índice 1)
        const color = coloresGrupos[i][1];

        // Aplica el color a la celda del grupo (Col I, constante 9)
        hoja.getRange(fila, COL_GRUPOS).setBackground(color);
        return; // Termina la función
      }
    }
    // Si no encuentra un color, no hace nada (se queda transparente)
  } catch (e) {
    Logger.log(`Error al aplicar color para el grupo ${textoGrupo} en fila ${fila}: ${e.message}`);
  }
}


// --- FUNCIONES DE AYUDA (Helpers) ---

/* */
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

/* */
function limpiarDNI(dni) {
  if (!dni) return '';
  // (Punto 35) Asegurarnos que la limpieza no afecte la validación
  return String(dni).replace(/[.\s-]/g, '').trim();
}

/* */
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

/* */
// (NUEVA MODIFICACIÓN) 'registrosActuales' se calcula contando la Columna A
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

      // (NUEVA MODIFICACIÓN) Contar registros basados en la Columna A (N° de Turno)
      const rangoTurnos = hojaRegistro.getRange(2, COL_NUMERO_TURNO, lastRow - 1, 1);
      const valoresTurnos = rangoTurnos.getValues();
      registrosActuales = valoresTurnos.filter(fila => fila[0] != null && fila[0] != "").length;

      // El conteo de Jornada Extendida sigue igual
      const data = hojaRegistro.getRange(2, COL_MARCA_N_E_A, lastRow - 1, 1).getValues();
      registrosJornadaExtendida = data.filter(row => String(row[0]).startsWith('Extendida')).length;
    }

    // Escribir el conteo robusto en la celda B2
    hojaConfig.getRange('B2').setValue(registrosActuales);
    hojaConfig.getRange('B5').setValue(registrosJornadaExtendida);
    SpreadsheetApp.flush();

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


// =========================================================
// (MODIFICADO - CORRECCIÓN DE BUG DE CUPO)
// =========================================================
function validarAcceso(dni, tipoInscripto) {
  try {
    // 1. VALIDACIONES BÁSICAS
    if (!dni) return { status: 'ERROR', message: 'El DNI no puede estar vacío.' };
    if (!/^[0-9]{8}$/.test(dni.trim())) {
      return { status: 'ERROR', message: 'El DNI debe tener exactamente 8 dígitos numéricos.' };
    }
    const dniLimpio = limpiarDNI(dni);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    if (!hojaConfig) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_CONFIG}" no fue encontrada.` };

    // 2. (¡¡¡NUEVO ORDEN!!!) VERIFICAR SI EL DNI YA ESTÁ EN "Registros"
    // Esto captura a los hermanos y a los que vuelven a pagar/subir ANTES del chequeo de cupo.
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    if (hojaRegistro && hojaRegistro.getLastRow() > 1) {
      const rangoDniRegistro = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
      const celdaRegistro = rangoDniRegistro.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

      if (celdaRegistro) {
        // ¡ENCONTRADO! Es un hermano o alguien volviendo.
        // Obtener el estado (cierre manual) y B22 (pago total) ANTES de pasarlo
        // No necesitamos el chequeo de 'estado.alcanzado' aquí.
        const estado = obtenerEstadoRegistro();
        if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };

        const pagoTotalHabilitado = hojaConfig.getRange('B22').getValue() === true;

        // Llamar a la función que maneja usuarios existentes. ESTA FUNCIÓN NO CHEQUEA CUPO.
        return gestionarUsuarioYaRegistrado(ss, hojaRegistro, celdaRegistro.getRow(), dniLimpio, estado, pagoTotalHabilitado, tipoInscripto);
      }
    }

    // 3. SI LLEGA AQUÍ, ES UN INSCRIPTO 100% NUEVO.
    // AHORA SÍ CHEQUEAR ESTADO Y CUPO.
    const estado = obtenerEstadoRegistro();
    if (estado.cierreManual) return { status: 'CERRADO', message: 'El formulario se encuentra cerrado por mantenimiento.' };

    // ¡¡¡EL CHEQUEO DE CUPO AHORA ESTÁ AQUÍ!!!
    // (Se mantiene la excepción de preventa)
    if (estado.alcanzado && tipoInscripto !== 'preventa') {
      // Si es 'nuevo' o 'anterior' (y no está en Registros), y el cupo está lleno, bloquear.
      return { status: 'LIMITE_ALCANZADO', message: 'Se ha alcanzado el cupo máximo para nuevos registros.' };
    }

    // 4. CONTINUAR CON LÓGICA DE NUEVO INSCRIPTO (Preventa, Anterior, Nuevo)
    const pagoTotalHabilitado = hojaConfig.getRange('B22').getValue() === true;

    // (Punto 25) CASO 1: INSCRIPTO PRE-VENTA
    if (tipoInscripto === 'preventa') {
      const hojaPreventa = ss.getSheetByName(NOMBRE_HOJA_PREVENTA);
      if (!hojaPreventa) return { status: 'ERROR', message: `La hoja de configuración "${NOMBRE_HOJA_PREVENTA}" no fue encontrada.` };

      const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
      const celdaEncontrada = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

      if (!celdaEncontrada) {
        // (INICIO CORRECCIÓN DE SINTAXIS)
        return { status: 'ERROR_TIPO_ANT', message: `El DNI ${dniLimpio} no se encuentra en la base de datos de Pre-Venta. Verifique el DNI o seleccione otro tipo de inscripción.` };
        // (FIN CORRECCIÓN DE SINTAXIS)
      }

      const fila = hojaPreventa.getRange(celdaEncontrada.getRow(), 1, 1, hojaPreventa.getLastColumn()).getValues()[0];

      const jornadaGuarda = String(fila[COL_PREVENTA_GUARDA - 1]).trim().toLowerCase();
      const jornadaPredefinida = (jornadaGuarda === 'si') ? 'Jornada Normal extendida' : 'Jornada Normal';

      // Validar cupo para la jornada asignada
      if (jornadaPredefinida === 'Jornada Normal extendida' && estado.jornadaExtendidaAlcanzada) {
        // (INICIO CORRECCIÓN DE SINTAXIS)
        return { status: 'LIMITE_EXTENDIDA', message: 'Su DNI de Pre-Venta corresponde a Jornada Extendida, pero el cupo ya se ha agotado. Por favor, contacte a la administración.' };
        // (FIN CORRECCIÓN DE SINTAXIS)
      }

      const fechaNacimientoRaw = fila[COL_PREVENTA_FECHA_NAC - 1];
      const fechaNacimientoStr = (fechaNacimientoRaw instanceof Date) ? Utilities.formatDate(fechaNacimientoRaw, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '';

      return {
        status: 'OK_PREVENTA', // Status nuevo para el cliente
        message: '✅ DNI de Pre-Venta validado. Se autocompletarán sus datos. Por favor, complete el resto del formulario.',
        datos: {
          email: fila[COL_PREVENTA_EMAIL - 1],
          nombre: fila[COL_PREVENTA_NOMBRE - 1],
          apellido: fila[COL_PREVENTA_APELLIDO - 1],
          dni: dniLimpio,
          fechaNacimiento: fechaNacimientoStr,
          jornada: jornadaPredefinida,
          esPreventa: true // Flag para que el cliente sepa cómo actuar
        },
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        pagoTotalHabilitado: pagoTotalHabilitado // (NUEVO - PUNTO C)
      };
    }

    // ========================================================
    // CASO 2: INSCRIPTO NUEVO O ANTERIOR (Lógica existente)
    // ========================================================
    const hojaBusqueda = ss.getSheetByName(NOMBRE_HOJA_BUSQUEDA);
    if (!hojaBusqueda) return { status: 'ERROR', message: `La hoja "${NOMBRE_HOJA_BUSQUEDA}" no fue encontrada.` };

    const rangoDNI = hojaBusqueda.getRange(2, COL_DNI_BUSQUEDA, hojaBusqueda.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDNI.createTextFinder(dniLimpio).matchEntireCell(true).findNext();

    if (celdaEncontrada) { // DNI encontrado en Base de Datos (posible ANTERIOR)

      // --- (INICIO BLOQUE PRE-VENTA - CORRECCIÓN) ---
      // (Punto 25) VALIDACIÓN CRUZADA: Si está en BD, pero también en Preventa, FORZAR a usar Pre-Venta.
      const hojaPreventa = ss.getSheetByName(NOMBRE_HOJA_PREVENTA);
      if (hojaPreventa && hojaPreventa.getLastRow() > 1) {
        const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
        const celdaEncontradaPreventa = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();
        if (celdaEncontradaPreventa) {
          // ¡Encontrado en Pre-Venta! Bloquear.
          return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
        }
      }
      // --- (FIN BLOQUE PRE-VENTA) ---

      if (tipoInscripto === 'nuevo') {
        return { status: 'ERROR_TIPO_NUEVO', message: "El DNI se encuentra en nuestra base de datos. Por favor, seleccione 'Soy Inscripto Anterior' y valide nuevamente." };
      }

      const rowIndex = celdaEncontrada.getRow();
      const fila = hojaBusqueda.getRange(rowIndex, COL_HABILITADO_BUSQUEDA, 1, 10).getValues()[0];
      const habilitado = fila[0];
      if (habilitado !== true) {
        // (INICIO CORRECCIÓN DE SINTAXIS)
        return { status: 'NO_HABILITADO', message: 'El DNI se encuentra en la base de datos, pero no está habilitado para la inscripción. Por favor, consulte con la organización.' };
        // (FIN CORRECCIÓN DE SINTAXIS)
      }

      const nombre = fila[1];
      const apellido = fila[2];
      const fechaNacimientoRaw = fila[3];
      const obraSocial = String(fila[6] || '').trim();
      const colegioJardin = String(fila[7] || '').trim();
      const responsable = String(fila[8] || '').trim();
      // const telefono = String(fila[9] || '').trim(); // <-- (MODIFICACIÓN: Esta línea ya no se usa)
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
          // (MODIFICACIÓN: Teléfono omitido según solicitud)
          // telResponsable1: telefono,
          esPreventa: false // Flag
        },
        edad: calcularEdad(fechaNacimientoStr),
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        pagoTotalHabilitado: pagoTotalHabilitado // (NUEVO - PUNTO C)
      };

    } else { // DNI NO encontrado en Base de Datos (posible NUEVO)

      // --- (INICIO BLOQUE PRE-VENTA - CORRECCIÓN) ---
      // (Punto 25) VALIDACIÓN CRUZADA: Si NO está en BD, pero SÍ en Preventa, FORZAR a usar Pre-Venta.
      const hojaPreventa = ss.getSheetByName(NOMBRE_HOJA_PREVENTA);
      if (hojaPreventa && hojaPreventa.getLastRow() > 1) {
        const rangoDniPreventa = hojaPreventa.getRange(2, COL_PREVENTA_DNI, hojaPreventa.getLastRow() - 1, 1);
        const celdaEncontradaPreventa = rangoDniPreventa.createTextFinder(dniLimpio).matchEntireCell(true).findNext();
        if (celdaEncontradaPreventa) {
          // ¡Encontrado en Pre-Venta! Bloquear.
          return { status: 'ERROR_TIPO_ANT', message: 'Usted tiene un cupo Pre-Venta. Por favor, elija la opción "Inscripto PRE-VENTA" para validar.' };
        }
      }
      // --- (FIN BLOQUE PRE-VENTA) ---

      if (tipoInscripto === 'anterior') {
        // (INICIO CORRECCIÓN DE SINTAXIS - Esta era tu línea 713-715)
        return { status: 'ERROR_TIPO_ANT', message: "No se encuentra en la base de datos de años anteriores. Por favor, seleccione 'Soy Nuevo Inscripto'." };
        // (FIN CORRECCIÓN DE SINTAXIS)
      }
      if (tipoInscripto === 'preventa') {
        // Este caso ya fue manejado arriba, pero por si acaso.
        return { status: 'ERROR_TIPO_ANT', message: `El DNI ${dniLimpio} no se encuentra en la base de datos de Pre-Venta.` };
      }
      return {
        status: 'OK_NUEVO',
        message: '✅ DNI validado. Proceda al registro.',
        jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
        tipoInscripto: tipoInscripto,
        datos: { dni: dniLimpio, esPreventa: false },
        pagoTotalHabilitado: pagoTotalHabilitado // (NUEVO - PUNTO C)
      };
    }

  } catch (e) {
    Logger.log("Error en validarAcceso: " + e.message + " Stack: " + e.stack);
    return { status: 'ERROR', message: 'Ocurrió un error al validar el DNI. ' + e.message };
  }
}


// =========================================================
// (CORRECCIÓN BUG HERMANO - ROBUSTA)
// (NUEVO - PUNTO C) Añadido 'pagoTotalHabilitado'
// (NUEVO - REQ 1) Añadido 'tipoInscripto' y validación estricta
// =========================================================
function gestionarUsuarioYaRegistrado(ss, hojaRegistro, filaRegistro, dniLimpio, estado, pagoTotalHabilitado, tipoInscripto) { // <-- (MODIFICADO) Acepta 'tipoInscripto'
const rangoFila = hojaRegistro.getRange(filaRegistro, 1, 1, hojaRegistro.getLastColumn()).getValues()[0];

const estadoPago = rangoFila[COL_ESTADO_PAGO - 1];
const metodoPago = rangoFila[COL_METODO_PAGO - 1];
const nombreRegistrado = rangoFila[COL_NOMBRE - 1] + ' ' + rangoFila[COL_APELLIDO - 1];
const estadoInscripto = rangoFila[COL_ESTADO_NUEVO_ANT - 1];

// (INICIO DE CORRECCIÓN - BUG HERMANO)
// Se usa .trim() y .includes() para ser robusto contra espacios y mayúsculas/minúsculas.
const estadoInscriptoTrim = estadoInscripto ? String(estadoInscripto).trim() : "";

// Lógica de HERMANO_COMPLETAR
if (estadoInscriptoTrim.toLowerCase().includes('hermano/a') && !metodoPago) { // <-- ¡MODIFICACIÓN CLAVE!
// --- (NUEVO - REQ 1) VALIDACIÓN ESTRICTA DE HERMANO ---
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
// --- (FIN NUEVO - REQ 1) ---

// (FIN DE CORRECCIÓN)
let faltantes = [];
// (MODIFICACIÓN) Se revisan los campos que el hermano DEBE completar
if (!rangoFila[COL_COLEGIO_JARDIN - 1]) faltantes.push('Colegio / Jardín');
if (!rangoFila[COL_PRACTICA_DEPORTE - 1]) faltantes.push('Practica Deporte');
if (!rangoFila[COL_TIENE_ENFERMEDAD - 1]) faltantes.push('Enfermedad Preexistente');
if (!rangoFila[COL_ES_ALERGICO - 1]) faltantes.push('Alergias');
if (!rangoFila[COL_FOTO_CARNET - 1]) faltantes.push('Foto Carnet 4x4');
if (!rangoFila[COL_JORNADA - 1]) faltantes.push('Jornada');
if (!rangoFila[COL_SOCIO - 1]) faltantes.push('Es Socio'); // (PUNTO 27) Añadido
if (!rangoFila[COL_METODO_PAGO - 1]) faltantes.push('Método de Pago');

// (MODIFICACIÓN) Se revisan los campos que DEBERÍAN estar pre-rellenados
// Con la corrección en 'registrarDatos', 'COL_EMAIL' ahora debería estar lleno.
if (!rangoFila[COL_EMAIL - 1]) faltantes.push('Email');
if (!rangoFila[COL_ADULTO_RESPONSABLE_1 - 1]) faltantes.push('Responsable 1');
if (!rangoFila[COL_PERSONAS_AUTORIZADAS - 1]) faltantes.push('Personas Autorizadas');

const datos = {
dni: dniLimpio,
nombre: rangoFila[COL_NOMBRE - 1],
apellido: rangoFila[COL_APELLIDO - 1],
// (SOLUCIÓN AL ERROR) Usa 'ss.getSpreadsheetTimeZone()' en lugar de 'SpreadsheetApp.getActive()'
fechaNacimiento: rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1] ? Utilities.formatDate(new Date(rangoFila[COL_FECHA_NACIMIENTO_REGISTRO - 1]), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : '',

// (MODIFICACIÓN) Estos campos ahora SÍ vendrán de la hoja
email: rangoFila[COL_EMAIL - 1] || '',
adultoResponsable1: rangoFila[COL_ADULTO_RESPONSABLE_1 - 1] || '',
dniResponsable1: rangoFila[COL_DNI_RESPONSABLE_1 - 1] || '',
telResponsable1: rangoFila[COL_TEL_RESPONSABLE_1 - 1] || '',
adultoResponsable2: rangoFila[COL_ADULTO_RESPONSABLE_2 - 1] || '',
telResponsable2: rangoFila[COL_TEL_RESPONSABLE_2 - 1] || '',
personasAutorizadas: rangoFila[COL_PERSONAS_AUTORIZADAS - 1] || '',
obraSocial: rangoFila[COL_OBRA_SOCIAL - 1] || '',

// Este campo (Colegio) se mantiene vacío a propósito (según tu lógica)
colegioJardin: rangoFila[COL_COLEGIO_JARDIN - 1] || ''
};

// Ya sea que falten campos por llenar o no (ej. si vuelve a validar),
// se le muestra el formulario para completar/revisar.
return {
status: 'HERMANO_COMPLETAR',
message: `⚠️ ¡Hola ${datos.nombre}! Eres un hermano/a pre-registrado.\n` +
`Por favor, complete/verifique TODOS los campos del formulario para obtener el cupo definitivo y el link para pagar.\n` +
(faltantes.length > 0 ? `Campos requeridos faltantes detectados: <strong>${faltantes.join(', ')}</strong>.` : 'Todos los campos parecen estar listos para verificar.'),
datos: datos,
jornadaExtendidaAlcanzada: estado.jornadaExtendidaAlcanzada,
tipoInscripto: estadoInscripto,
pagoTotalHabilitado: pagoTotalHabilitado // (NUEVO - PUNTO C)
};
}
// Lógica de REGISTRO_ENCONTRADO (Repago, Subir comprobante, etc.)
// (Si es un HERMANO que YA COMPLETÓ, el código saltará aquí)
const aptitudFisica = rangoFila[COL_APTITUD_FISICA - 1];
const adeudaAptitud = !aptitudFisica;
const cantidadCuotasRegistrada = parseInt(rangoFila[COL_CANTIDAD_CUOTAS - 1]) || 0;
let proximaCuotaPendiente = null;

// --- (MODIFICACIÓN CRÍTICA) ---
// Se cambia 'estadoPago === 'Pagado'' por 'String(estadoPago).includes('Pagado')'
// Esto captura "Pagado", " Pagado", "Pagado." etc. y previene el repago.
if (String(estadoPago).includes('Pagado')) {
return {
status: 'REGISTRO_ENCONTRADO',
message:  `✅ El DNI  ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO y la inscripción está PAGADA.`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: null
};
}

// --- (NUEVA MODIFICACIÓN) ---
// Si está "En revisión" (porque ya subió un comprobante), mostrar solo el mensaje.
// No intentar generar link de pago ni mostrar el uploader.
if (String(estadoPago).includes('En revisión')) {
return {
status: 'REGISTRO_ENCONTRADO',
message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. Su pago está "En revisión".`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: null
};
}

if (String(metodoPago).includes('Efectivo') || String(metodoPago).includes('Transferencia')) {
return {
status: 'REGISTTIPO_ENCONTRADO',
message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO. El pago (${metodoPago}) está PENDIENTE.`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: 'subir_comprobante_manual' // <-- ¡¡¡ESTE ES EL CAMBIO!!!
};
}

// Lógica de repago...
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
// Si todas las cuotas están pagadas, pero el estado general (AI) no es "Pagado"
// (porque quizás falta aptitud, etc.), igual lo tratamos como pagado.
return {
status: 'REGISTRO_ENCONTRADO',
message:  `✅ El DNI  ${dniLimpio} (${nombreRegistrado}) ya completó todas las cuotas.`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: null
};
}
} else if (metodoPago === 'Pago 1 Cuota Deb/Cred MP(Total)') {
// (NUEVO - PUNTO C) Si el pago total está deshabilitado por B22, no generar link.
if (pagoTotalHabilitado === false) {
return {
status: 'REGISTRO_ENCONTRADO',
message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya está REGISTRADO. El pago (${metodoPago}) está PENDIENTE, pero la opción de pago online está desactivada.`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: null
};
}
}

// --- ¡¡MODIFICACIÓN!! ---
// Llama a la función que ahora vive en PagosMP.gs
const init_point = crearPreferenciaDePago(datosParaPago, identificadorPago, cantidadCuotasRegistrada);

if (!init_point || !init_point.toString().startsWith('http')) {
return {
status: 'REGISTRO_ENCONTRADO',
message: `⚠️ Error al generar link: ${init_point}`,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: proximaCuotaPendiente,
error_init_point: init_point
};
}

return {
status: 'REGISTRO_ENCONTRADO',
message: `⚠️ El DNI ${dniLimpio} (${nombreRegistrado}) ya se encuentra REGISTRADO.
Se generó un link para la próxima cuota pendiente (${identificadorPago || 'Pago Total'}).`,
init_point: init_point,
adeudaAptitud: adeudaAptitud,
cantidadCuotas: cantidadCuotasRegistrada,
metodoPago: metodoPago,
proximaCuotaPendiente: proximaCuotaPendiente
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
error_init_point: e.message
};
}
}



// =========================================================
// (Punto 10) enviarEmailConfirmacion (ACTUALIZADO)
// =========================================================
/**
 * (M) FUNCIÓN DE EMAIL (SIMPLIFICADA)
 * (Punto 10) Agrega template para "Transferencia"
 */
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

    // (Punto 2) Usar nombre y apellido
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

      // (Punto 10) NUEVO CASO PARA TRANSFERENCIA
    } else if (metodo === 'Transferencia') {
      asunto = "Confirmación de Registro (Transferencia)"; // Asunto genérico (o agregar a Config)
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
        .replace(/{{linkCuota1}}/g, init_point.link1 || 'Error al generar')
        .replace(/{{linkCuota2}}/g, init_point.link2 || 'Error al generar')
        .replace(/{{linkCuota3}}/g, init_point.link3 || 'Error al generar');

    } else {
      Logger.log(`Método de pago "${datos.metodoPago}" no reconocido para email.`);
      return;
    }

    // (Punto 29) DESACTIVADO
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

// =========================================================
// (Punto 15, 17, 19) subirComprobanteManual (DUPLICADO - ELIMINAR ESTA COPIA)
// =========================================================
// (Esta función está duplicada en el archivo original, la dejo como estaba)
/*
// La función subirComprobanteManual ya está definida arriba (línea 358), 
// esta segunda copia es innecesaria y puede causar errores si es diferente.
// Se recomienda eliminar este bloque duplicado.
*/

/* */
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

/* */
function sincronizarRegistros() {
  Logger.log("sincronizarRegistros: Función omitida.");
  return;
}

/* */
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

// (NOTA: He eliminado la función 'subirComprobanteManual' duplicada que estaba al final de tu archivo original)