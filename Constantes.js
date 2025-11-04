// --- CONSTANTES GLOBALES ---
const SPREADSHEET_ID = '1Ru-XGng2hYJbUvl-H2IA7aYQx7Ju-jk1LT1fkYOnG0w';
/* */
const NOMBRE_HOJA_BUSQUEDA = 'Base de Datos';
const NOMBRE_HOJA_REGISTRO = 'Registros';
const NOMBRE_HOJA_CONFIG = 'Config';

/* */
const FOLDER_ID_FOTOS = '1S2SbkuYdvcLFZYoHacfgwEU80kAN094l';
const FOLDER_ID_FICHAS = '1aDsTTDWHiDFUeZ8ByGp8_LY3fdzVQomu';
const FOLDER_ID_COMPROBANTES = '169EISq4RsDetQ0H3B17ViZFfe25xPcMM';

// =========================================================
// (Punto 1) CONSTANTES "Base de Datos" ACTUALIZADAS
// =========================================================
const COL_HABILITADO_BUSQUEDA = 2; // Col B
const COL_NOMBRE_BUSQUEDA = 3; // Col C (NUEVA)
const COL_APELLIDO_BUSQUEDA = 4; // Col D (NUEVA)
const COL_FECHA_NACIMIENTO_BUSQUEDA = 5; // Col E (antes D=4)
// Col F (Edad) se salta
const COL_DNI_BUSQUEDA = 7; // Col G (antes F=6)
const COL_OBRASOCIAL_BUSQUEDA = 8; // Col H (antes G=7)
const COL_COLEGIO_BUSQUEDA = 9; // Col I (antes H=8)
const COL_RESPONSABLE_BUSQUEDA = 10; // Col J (antes I=9)
const COL_TELEFONO_BUSQUEDA = 11; // Col K (antes J=10)
// =========================================================
// (MODIFICADO) CONSTANTES "Registros" ACTUALIZADAS (48 columnas - Punto 34)
// =========================================================
const COL_NUMERO_TURNO = 1; // A
const COL_MARCA_TEMPORAL = 2; // B
const COL_MARCA_N_E_A = 3; // C
const COL_ESTADO_NUEVO_ANT = 4; // D
const COL_EMAIL = 5; // E
const COL_NOMBRE = 6; // F
const COL_APELLIDO = 7; // G
const COL_FECHA_NACIMIENTO_REGISTRO = 8; // H
const COL_GRUPOS = 9; // I (REEMPLAZA A EDAD_ACTUAL)
const COL_DNI_INSCRIPTO = 10; // J
const COL_OBRA_SOCIAL = 11; // K
const COL_COLEGIO_JARDIN = 12; // L
const COL_ADULTO_RESPONSABLE_1 = 13; // M
const COL_DNI_RESPONSABLE_1 = 14; // N
const COL_TEL_RESPONSABLE_1 = 15; // O
const COL_ADULTO_RESPONSABLE_2 = 16; // P
const COL_TEL_RESPONSABLE_2 = 17; // Q
const COL_PERSONAS_AUTORIZADAS = 18; // R
const COL_PRACTICA_DEPORTE = 19; // S
const COL_ESPECIFIQUE_DEPORTE = 20; // T
const COL_TIENE_ENFERMEDAD = 21; // U
const COL_ESPECIFIQUE_ENFERMEDAD = 22; // V
const COL_ES_ALERGICO = 23; // W
const COL_ESPECIFIQUE_ALERGIA = 24; // X
const COL_APTITUD_FISICA = 25; // Y
const COL_FOTO_CARNET = 26; // Z
const COL_JORNADA = 27; // AA
const COL_SOCIO = 28; // AB (NUEVA COLUMNA - PUNTO 27)
const COL_METODO_PAGO = 29; // AC (antes 28)
const COL_PRECIO = 30; // AD (antes 29)
const COL_CUOTA_1 = 31; // AE (antes 30)
const COL_CUOTA_2 = 32; // AF (antes 31)
const COL_CUOTA_3 = 33; // AG (antes 32)
const COL_CANTIDAD_CUOTAS = 34; // AH (antes 33)
const COL_ESTADO_PAGO = 35; // AI (antes 34)
const COL_MONTO_A_PAGAR = 36; // AJ (antes 35)
const COL_ID_PAGO_MP = 37; // AK (antes 36)
const COL_PAGADOR_NOMBRE = 38; // AL (antes 37)
const COL_DNI_PAGADOR_MP = 39; // AM (antes 38)
const COL_PAGADOR_NOMBRE_MANUAL = 40; // AN (antes 39)
const COL_PAGADOR_DNI_MANUAL = 41; // AO (antes 40)
const COL_COMPROBANTE_MP = 42; // AP (antes 41)
const COL_COMPROBANTE_MANUAL_TOTAL_EXT = 43; // AQ (antes 42)
const COL_COMPROBANTE_MANUAL_CUOTA1 = 44; // AR (antes 43)
const COL_COMPROBANTE_MANUAL_CUOTA2 = 45; // AS (antes 44)
const COL_COMPROBANTE_MANUAL_CUOTA3 = 46; // AT (antes 45)
const COL_ENVIAR_EMAIL_MANUAL = 47; // AU (antes 46)
const COL_VINCULO_PRINCIPAL = 48; // AV (NUEVA - PUNTO 34)


// (Punto 25) CONSTANTES PARA LA NUEVA HOJA "Preventa"
const NOMBRE_HOJA_PREVENTA = 'PRE-VENTA';
const COL_PREVENTA_EMAIL = 3;       // Col C
const COL_PREVENTA_NOMBRE = 4;      // Col D
const COL_PREVENTA_APELLIDO = 5;    // Col E
const COL_PREVENTA_DNI = 6;         // Col F
const COL_PREVENTA_FECHA_NAC = 7;   // Col G
const COL_PREVENTA_GUARDA = 9;      // Col I