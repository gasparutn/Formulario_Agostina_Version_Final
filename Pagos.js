// =========================================================
// Las constantes (COL_EMAIL, COL_ESTADO_PAGO, etc.) se leen
// automáticamente desde el archivo 'Constantes.gs'.
//
// LA LÓGICA DE MERCADO PAGO (TOKEN, URL, WEBHOOKS, PREFERENCIAS)
// SE MOVIÓ A PagosMP.gs
// =========================================================

/**
* (PASO 1)
* (Punto 10) Añadida lógica para "Transferencia"
* (Punto 28) Lógica de "Pago en Cuotas" ajustada para "Pago en 3 Cuotas"
*/
function paso1_registrarRegistro(datos) {
  Logger.log("PASO 1 INICIADO. Datos recibidos: " + JSON.stringify(datos));
  try {
    if (!datos.urlFotoCarnet && !datos.esHermanoCompletando) { // (Punto 6) Los hermanos no suben foto en el registro inicial
      Logger.log("Error: El formulario se envió sin la URL de la Foto Carnet.");
      return { status: 'ERROR', message: 'Falta la Foto Carnet. Por favor, asegúrese de que el archivo se haya subido correctamente.' };
    }

    // (Punto 10) Nuevos estados de pago
    if (datos.metodoPago === 'Pago Efectivo (Adm del Club)') {
      datos.estadoPago = "Pendiente (Efectivo)";
    } else if (datos.metodoPago === 'Transferencia') {
      datos.estadoPago = "Pendiente (Transferencia)"; // NUEVO
      // (Punto 28) Ajuste de "Pago en Cuotas" a "Pago en 3 Cuotas" (o mantener "Pago en Cuotas" si el valor enviado no cambió)
    } else if (datos.metodoPago === 'Pago en Cuotas') {
      datos.estadoPago = `Pendiente (${datos.cantidadCuotas} Cuotas)`; // (datos.cantidadCuotas será 3)
    } else { // 'Pago 1 Cuota Deb/Cred MP(Total)'
      datos.estadoPago = "Pendiente";
    }

    // (Punto 12) Si es un hermano completando, llamamos a una función diferente
    if (datos.esHermanoCompletando === true) {
      const respuestaUpdate = actualizarDatosHermano(datos);
      return respuestaUpdate;
    } else {
      // Si es registro normal, llamamos a registrarDatos (que ahora maneja hermanos)
      const respuestaRegistro = registrarDatos(datos); // registrarDatos() vive en codigo.gs
      return respuestaRegistro;
    }

  } catch (e) {
    Logger.log("Error en paso1_registrarRegistro: " + e.message);
    return { status: 'ERROR', message: 'Error general en el servidor (Paso 1): ' + e.message };
  }
}

// =========================================================
// (NUEVA FUNCIÓN HELPER para solucionar error de 'hermano')
// =========================================================
/**
 * Obtiene el precio y el monto a pagar desde la hoja de Config.
 * @param {string} metodoPago - El método de pago seleccionado.
 * @param {string|number} cantidadCuotasStr - La cantidad de cuotas (ej. "3").
 * @param {GoogleAppsScript.Spreadsheet.Sheet} hojaConfig - La hoja de "Config".
 * @returns {{precio: number, montoAPagar: number}}
 */
function obtenerPrecioDesdeConfig(metodoPago, cantidadCuotasStr, hojaConfig) {
  let precio = 0;
  let montoAPagar = 0;
  try {
    const precioCuota = hojaConfig.getRange("B20").getValue();
    const precioTotal = hojaConfig.getRange("B14").getValue();

    if (metodoPago === 'Pago en Cuotas') {
      precio = precioCuota;
      montoAPagar = precio * (parseInt(cantidadCuotasStr) || 0);
    } else if (metodoPago === 'Pago 1 Cuota Deb/Cred MP(Total)') {
      precio = precioTotal;
      montoAPagar = precio;
    } else if (metodoPago === 'Pago Efectivo (Adm del Club)' || metodoPago === 'Transferencia') {
      precio = precioTotal;
      montoAPagar = precio;
    }

    // Fallbacks
    if (precio === 0 && precioTotal > 0) {
      precio = precioTotal;
    }
    if (montoAPagar === 0 && precio > 0 && (metodoPago === 'Pago Efectivo (Adm del Club)' || metodoPago === 'Transferencia')) {
      montoAPagar = precio;
    }

    return { precio, montoAPagar };

  } catch (e) {
    Logger.log("Error en obtenerPrecioDesdeConfig: " + e.message);
    return { precio: 0, montoAPagar: 0 };
  }
}


/**
* (Punto 6, 12, 27) NUEVA FUNCIÓN para actualizar un hermano (ACTUALIZADA)
*/
function actualizarDatosHermano(datos) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaRegistro = ss.getSheetByName(NOMBRE_HOJA_REGISTRO);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    const dniBuscado = limpiarDNI(datos.dni); // Asume que limpiarDNI() está en Código.js (global)

    if (!hojaRegistro) throw new Error("Hoja de Registros no encontrada");

    const rangoDni = hojaRegistro.getRange(2, COL_DNI_INSCRIPTO, hojaRegistro.getLastRow() - 1, 1);
    const celdaEncontrada = rangoDni.createTextFinder(dniBuscado).matchEntireCell(true).findNext();

    if (!celdaEncontrada) {
      return { status: 'ERROR', message: 'No se encontró el registro del hermano para actualizar.' };
    }

    const fila = celdaEncontrada.getRow();

    // --- CÁLCULO DE PRECIOS ---
    const { precio, montoAPagar } = obtenerPrecioDesdeConfig(datos.metodoPago, datos.cantidadCuotas, hojaConfig);

    const telResp1 = `(${datos.telAreaResp1}) ${datos.telNumResp1}`;
    const telResp2 = (datos.telAreaResp2 && datos.telNumResp2) ? `(${datos.telAreaResp2}) ${datos.telNumResp2}` : '';

    // --- (MODIFICACIÓN) ---
    // Reemplazada la lógica de 'E'/'N' por la lógica completa.
    const esPreventa = (datos.tipoInscripto === 'preventa');
    let marcaNE = "";
    if (datos.jornada === 'Jornada Normal extendida') {
      marcaNE = esPreventa ? "Extendida (Pre-venta)" : "Extendida";
    } else { // Asume "Jornada Normal"
      marcaNE = esPreventa ? "Normal (Pre-Venta)" : "Normal";
    }
    // --- (FIN MODIFICACIÓN) ---


    // (Punto 6, 27) Actualizar la fila del hermano con los datos completos
    hojaRegistro.getRange(fila, COL_MARCA_N_E_A).setValue(marcaNE);
    hojaRegistro.getRange(fila, COL_EMAIL).setValue(datos.email);
    hojaRegistro.getRange(fila, COL_OBRA_SOCIAL).setValue(datos.obraSocial);
    hojaRegistro.getRange(fila, COL_COLEGIO_JARDIN).setValue(datos.colegioJardin);
    hojaRegistro.getRange(fila, COL_ADULTO_RESPONSABLE_1).setValue(datos.adultoResponsable1);
    hojaRegistro.getRange(fila, COL_DNI_RESPONSABLE_1).setValue(datos.dniResponsable1);
    hojaRegistro.getRange(fila, COL_TEL_RESPONSABLE_1).setValue(telResp1);
    hojaRegistro.getRange(fila, COL_ADULTO_RESPONSABLE_2).setValue(datos.adultoResponsable2);
    hojaRegistro.getRange(fila, COL_TEL_RESPONSABLE_2).setValue(telResp2);
    hojaRegistro.getRange(fila, COL_PERSONAS_AUTORIZADAS).setValue(datos.personasAutorizadas);
    hojaRegistro.getRange(fila, COL_PRACTICA_DEPORTE).setValue(datos.practicaDeporte);
    hojaRegistro.getRange(fila, COL_ESPECIFIQUE_DEPORTE).setValue(datos.especifiqueDeporte);
    hojaRegistro.getRange(fila, COL_TIENE_ENFERMEDAD).setValue(datos.tieneEnfermedad);
    hojaRegistro.getRange(fila, COL_ESPECIFIQUE_ENFERMEDAD).setValue(datos.especifiqueEnfermedad);
    hojaRegistro.getRange(fila, COL_ES_ALERGICO).setValue(datos.esAlergico);
    hojaRegistro.getRange(fila, COL_ESPECIFIQUE_ALERGIA).setValue(datos.especifiqueAlergia);
    hojaRegistro.getRange(fila, COL_APTITUD_FISICA).setValue(datos.urlCertificadoAptitud || '');
    hojaRegistro.getRange(fila, COL_FOTO_CARNET).setValue(datos.urlFotoCarnet || '');
    hojaRegistro.getRange(fila, COL_JORNADA).setValue(datos.jornada);
    hojaRegistro.getRange(fila, COL_SOCIO).setValue(datos.esSocio); // (PUNTO 27) NUEVA LÍNEA
    hojaRegistro.getRange(fila, COL_METODO_PAGO).setValue(datos.metodoPago);
    hojaRegistro.getRange(fila, COL_PRECIO).setValue(precio);
    hojaRegistro.getRange(fila, COL_CANTIDAD_CUOTAS).setValue(parseInt(datos.cantidadCuotas) || 0); // (será 3)
    hojaRegistro.getRange(fila, COL_ESTADO_PAGO).setValue(datos.estadoPago);
    hojaRegistro.getRange(fila, COL_MONTO_A_PAGAR).setValue(montoAPagar);

    SpreadsheetApp.flush();

    // (Punto 2) Necesita nombre/apellido para el email
    datos.nombre = hojaRegistro.getRange(fila, COL_NOMBRE).getValue();
    datos.apellido = hojaRegistro.getRange(fila, COL_APELLIDO).getValue();

    return { status: 'OK_REGISTRO', message: '¡Registro de Hermano Actualizado!', numeroDeTurno: hojaRegistro.getRange(fila, COL_NUMERO_TURNO).getValue(), datos: datos };

  } catch (e) {
    Logger.log("Error en actualizarDatosHermano: " + e.message);
    return { status: 'ERROR', message: 'Error general en el servidor (Actualizar Hermano): ' + e.message };
  } finally {
    lock.releaseLock();
  }
}


/**
* (PASO 2)
* (Punto 10) Añadida lógica para "Transferencia"
* (Punto 29) Emails automáticos desactivados
* (Punto 40) Mensaje de "Pagos Desactivados" actualizado
*
* *** ¡¡MODIFICACIÓN!! Llama a crearPreferenciaDePago (que ahora vive en PagosMP.gs) ***
*
*/
function paso2_crearPagoYEmail(datos, numeroDeTurno) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const hojaConfig = ss.getSheetByName(NOMBRE_HOJA_CONFIG);
    const pagosHabilitados = hojaConfig.getRange('B23').getValue();

    const hermanos = datos.hermanos || [];

    if (pagosHabilitados === false) {
      Logger.log(`Pagos deshabilitados (Config B23). Registrando sin link!!`);
      // (Punto 29) Email automático desactivado.
      // enviarEmailConfirmacion(datos, numeroDeTurno, null, 'registro_sin_pago'); // vive en Código.js
      
      return { status: 'OK_REGISTRO_SIN_PAGO', message: `¡¡Registo exitoso!! acérquese a la administración para pagar de forma presencial en efectivo o puede trasnferir y subir el comprobante.`, hermanos: hermanos };
    }

    // (Punto 10) Manejar Efectivo y Transferencia
    if (datos.metodoPago === 'Pago Efectivo (Adm del Club)' || datos.metodoPago === 'Transferencia') {
      // (Punto 29) Email automático desactivado.
      // enviarEmailConfirmacion(datos, numeroDeTurno); // vive en Código.js
      let message = (datos.metodoPago === 'Transferencia') ?
        '¡Registro exitoso! Por favor, realice la transferencia y luego suba el comprobante.' :
        '¡Registro exitoso! Por favor, acérquese a la administración para completar el pago.';
      return { status: 'OK_EFECTIVO', message: message, hermanos: hermanos };
    }

    // --- ¡¡INICIO DE BLOQUE MERCADO PAGO!! ---
    // Estas llamadas ahora son a funciones en PagosMP.gs
    
    if (datos.metodoPago === 'Pago 1 Cuota Deb/Cred MP(Total)') {
      let init_point;
      try {
        init_point = crearPreferenciaDePago(datos, null); // Llama a PagosMP.gs

        if (!init_point || !init_point.startsWith('http')) {
          return { status: 'OK_REGISTRO_SIN_LINK', message: init_point, hermanos: hermanos };
        }
      } catch (e) {
        Logger.log("Error al crear preferencia de pago (total): " + e.message);
        return { status: 'OK_REGISTRO_SIN_LINK', message: `¡Tu registro se guardó!! Pero falló la creación del link de pago.\nPor favor, contacte a la administración para abonar.`, hermanos: hermanos };
      }

      if (datos.email && init_point) {
        // (Punto 29) Email automático desactivado.
        // enviarEmailConfirmacion(datos, numeroDeTurno, init_point); // vive en Código.js
      }
      return { status: 'OK_PAGO', init_point: init_point, hermanos: hermanos };
    }

    if (datos.metodoPago === 'Pago en Cuotas') {
      const cantidadCuotas = parseInt(datos.cantidadCuotas); // (Será 3)
      const emailLinks = {};

      try {
        const cuotasDisponibles = (cantidadCuotas === 2) ? [1, 2] : [1, 2, 3]; // (Será 3)

        for (let i = 1; i <= 3; i++) {
          if (cuotasDisponibles.includes(i)) {
            const link = crearPreferenciaDePago(datos, `C${i}`, cantidadCuotas); // Llama a PagosMP.gs
            emailLinks[`link${i}`] = link;
          } else {
            emailLinks[`link${i}`] = 'N/A (No aplica)';
          }
        }

      } catch (e) {
        Logger.log("Error al crear preferencias de pago (cuotas): " + e.message);
        return { status: 'OK_REGISTRO_SIN_LINK', message: `¡Tu registro se guardó!! Pero falló la creación de los links de pago.\nPor favor, contacte a la administración.`, hermanos: hermanos };
      }

      if (datos.email) {
        // (Punto 29) Email automático desactivado.
        // enviarEmailConfirmacion(datos, numeroDeTurno, emailLinks); // vive en Código.js
      }

      const primerLink = emailLinks.link1;
      if (!primerLink || !primerLink.startsWith('http')) {
        return { status: 'OK_REGISTRO_SIN_LINK', message: `¡Registro guardado!! ${primerLink}`, hermanos: hermanos };
      }
      return { status: 'OK_PAGO', init_point: primerLink, hermanos: hermanos };
    }
    // --- ¡¡FIN DE BLOQUE MERCADO PAGO!! ---

  } catch (e) {
    Logger.log("Error en paso2_crearPagoYEmail: " + e.message);
    return { status: 'ERROR', message: 'Error general en el servidor (Paso 2): ' + e.message, hermanos: [] };
  }
}

// --- TODAS LAS FUNCIONES DE MP FUERON MOVIDAS A PagosMP.gs ---
// (crearPreferenciaDePago, procesarNotificacionDePago, actualizarEstadoEnPlanilla, enviarEmailPagoConfirmado, enviarEmailInscripcionCompleta)