// js/constants.js
export const METODOS_DE_PAGO_IMPORTACION = ['Efectivo', 'Nequi', 'Bancolombia'];
export const METODOS_DE_PAGO = ['Efectivo', 'Nequi', 'Bancolombia'];
export const ESTADOS_REMISION = ['Recibido', 'En Proceso', 'Procesado', 'Entregado'];
export const ALL_MODULES = ['remisiones', 'facturacion', 'inventario', 'clientes', 'gastos', 'proveedores', 'prestamos', 'empleados', 'items','funciones'];

export const RRHH_DOCUMENT_TYPES = [
    { id: 'contrato', name: 'Contrato' }, { id: 'hojaDeVida', name: 'Hoja de Vida' }, 
    { id: 'examenMedico', name: 'Examen Médico' }, { id: 'cedula', name: 'Cédula (PDF)' }, 
    { id: 'certificadoARL', name: 'Certificado ARL' }, { id: 'certificadoEPS', name: 'Certificado EPS' }, 
    { id: 'certificadoAFP', name: 'Certificado AFP' }, { id: 'cartaRetiro', name: 'Carta de renuncia o despido' }, 
    { id: 'liquidacionDoc', name: 'Liquidación' }
];

export const GASTOS_IMPORTACION = [
    { id: 'pi', name: 'PI' }, { id: 'factura', name: 'Factura' }, { id: 'packingList', name: 'Packing List' }, 
    { id: 'gastosNaviera', name: 'Gastos Naviera' }, { id: 'gastosPuerto', name: 'Gastos Puerto' }, 
    { id: 'gastosAduana', name: 'Gastos Aduana' }, { id: 'dropOff', name: 'Drop Off' }, 
    { id: 'gastosTransporte', name: 'Gastos Transporte' }, { id: 'gastosMontacarga', name: 'Gastos Montacarga' }
];

export const DOCUMENTOS_IMPORTACION = [
    { id: 'provideInvoice', name: 'Provide Invoice' },
    { id: 'facturaComercial', name: 'Factura Comercial' },
    { id: 'packingList', name: 'Packing List' },
    { id: 'bl', name: 'BL' },
    { id: 'seguroDoc', name: 'Póliza de Seguro' },
    { id: 'docAduana', name: 'Documentos Enviados por Aduana' }
];

export const GASTOS_NACIONALIZACION = [
    { id: 'iva', name: 'IVA' },
    { id: 'arancel', name: 'Arancel' },
    { id: 'naviera', name: 'Naviera' },
    { id: 'puerto', name: 'Puerto' },
    { id: 'aduana', name: 'Aduana' },
    { id: 'transporte', name: 'Transporte' },
    { id: 'montacarga', name: 'Montacarga' }
];