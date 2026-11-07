// js/utils.js

export function formatCurrency(value) { 
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value); 
}

export function unformatCurrency(value) {
    if (typeof value !== 'string') return parseFloat(value) || 0;
    return parseFloat(value.replace(/[^0-9]/g, '')) || 0;
}

export function formatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? formatCurrency(value) : '';
}

export function unformatCurrencyInput(inputElement) {
    const value = unformatCurrency(inputElement.value);
    inputElement.value = value > 0 ? value : '';
}

export function normalizeText(text) {
    if (!text) return '';
    return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function getOperationDays(fechaPedido) {
    if (!fechaPedido) return '';
    const hoy = new Date();
    const pedido = new Date(fechaPedido + 'T00:00:00');
    hoy.setHours(0, 0, 0, 0);

    const diffTime = hoy - pedido;
    if (diffTime < 0) return '';
    
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Inició hoy';
    if (diffDays === 1) return '1 día en operación';
    return `${diffDays} días en operación`;
}

export function isUserIncapacitatedOnDate(emp, date) {
    if (!emp || !emp.incapacitado || !emp.incapacidadStart || !emp.incapacidadDays) return false;
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const incStart = new Date(emp.incapacidadStart + 'T00:00:00');
    incStart.setHours(0, 0, 0, 0);
    const incEnd = new Date(incStart);
    incEnd.setDate(incStart.getDate() + emp.incapacidadDays - 1);
    incEnd.setHours(0, 0, 0, 0);
    return targetDate >= incStart && targetDate <= incEnd;
}