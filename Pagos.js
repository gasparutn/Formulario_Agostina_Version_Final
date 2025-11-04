// =========================================================
// Las constantes (COL_EMAIL, COL_ESTADO_PAGO, etc.) se leen
// automáticamente desde el archivo 'Constantes.gs'.
//
// (MODIFICADO) TODA LA LÓGICA DE MERCADO PAGO HA SIDO ELIMINADA.
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
    } else if (datos.metodoPago === 'Pago en Cuotas') {
      datos.estadoPago = `Pendiente (${datos.cantidadCuotas} Cuotas)`; // (datos.cantidadCuotas será 3)
    } else { 
      // Fallback por si algún método de MP quedó cacheado (ya no debería pasar)
      datos.estadoPago = "Pendiente (Transferencia)";
    }

    // (Punto 12) Si es un hermano completando, llamamos a una función diferente
    if (datos.esHermanoCompletando === true) {
      // (MODIFICADO) Se pasa 'datos' directamente
      const respuestaUpdate = actualizarDatosHermano(datos);
      // Asignar datos de nombre/apellido a la respuesta para el 'paso2'
      respuestaUpdate.datos = datos; 
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
      // (MODIFICADO) Precio ahora es el total de cuotas, monto a pagar también.
      const numCuotas = parseInt(cantidadCuotasStr) || 3;
      precio = precioCuota * numCuotas;
      montoAPagar = precio;
    } else if (metodoPago === 'Pago Efectivo (Adm del Club)' || metodoPago === 'Transferencia') {
      precio = precioTotal;
      montoAPagar = precio;
    }

    // Fallbacks
    if (precio === 0 && precioTotal > 0) {
      precio = precioTotal;
    }
    if (montoAPagar === 0 && precio > 0) {
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

    return { status: 'OK_REGISTRO', message: '¡Registro de Hermano Actualizado!', numeroDeTurno: hojaRegistro.getRange(fila, COL_NUMERO_TURNO).getValue() };

  } catch (e) {
    Logger.log("Error en actualizarDatosHermano: " + e.message);
    return { status: 'ERROR', message: 'Error general en el servidor (Actualizar Hermano): ' + e.message };
  } finally {
    lock.releaseLock();
  }
}


/**
* (PASO 2 - MODIFICADO)
* Eliminada toda la lógica de Mercado Pago.
* Ahora solo envía confirmación para Efectivo, Transferencia o Cuotas (que son manuales).
*/
function paso2_crearPagoYEmail(datos, numeroDeTurno, hermanosRegistrados = null) {
  try {
    const hermanos = hermanosRegistrados || [];
    const dniRegistrado = datos.dni;
    let message = "";

    if (datos.metodoPago === 'Pago Efectivo (Adm del Club)') {
      message = `¡Registro guardado con éxito!!.<br>Su método de pago es: <strong>${datos.metodoPago}</strong>. acérquese a la Secretaría del Club de Martes a Sábados de 11hs a 18hs.`;
    } else if (datos.metodoPago === 'Transferencia') {
      message = `¡Registro guardado con éxito!!.<br>Su método de pago es: <strong>${datos.metodoPago}</strong>. Realice la transferencia y vuelva a ingresar con su DNI para subir el comprobante.`;
    } else if (datos.metodoPago === 'Pago en Cuotas') {
      message = `¡Registro guardado con éxito!!.<br>Su método de pago es: <strong>Pago en 3 Cuotas</strong>. Realice la transferencia de la primer cuota y vuelva a ingresar con su DNI para subir el comprobante.`;
    } else {
      message = `¡Registro guardado con éxito!!. Contacte a la administración para coordinar el pago.`;
    }

    // (Punto 29) Email automático desactivado.
    // enviarEmailConfirmacion(datos, numeroDeTurno, null); // vive en Código.js
    Logger.log(`(Paso 2) Registro exitoso para DNI ${dniRegistrado}. Método: ${datos.metodoPago}. Email desactivado.`);

    return { 
      status: 'OK_EFECTIVO', // Usamos el status de éxito manual
      message: message, 
      hermanos: hermanos,
      dniRegistrado: dniRegistrado 
    };

  } catch (e) {
    Logger.log("Error en paso2_crearPagoYEmail: " + e.message);
    return { 
      status: 'ERROR', 
      message: 'Error general en el servidor (Paso 2): ' + e.message, 
      hermanos: [],
      dniRegistrado: datos.dni 
    };
  }
}