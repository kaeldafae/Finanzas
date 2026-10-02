import { describe, expect, it } from 'vitest';
import { cifrar, derivarClave, descifrar, ErrorCifrado, generarSal, leerSobre, validarContrasena } from './cifrado';

// Iteraciones bajas solo en tests; la app usa 600.000.
const IT = 1000;

describe('cifrado de extremo a extremo', () => {
  it('cifra y descifra (con tildes, € y textos largos)', async () => {
    const sal = generarSal();
    const clave = await derivarClave('una frase larga de prueba', sal, IT);
    const texto = JSON.stringify({ nota: 'Nómina de junio · 1.050,00 €', relleno: 'x'.repeat(50_000) });
    const sobre = await cifrar(clave, texto, { sal, iteraciones: IT });
    expect(sobre.datos).not.toContain('Nómina');
    expect(sobre.datos.length).toBeLessThan(texto.length); // comprimido
    expect(await descifrar(clave, leerSobre(JSON.stringify(sobre)))).toBe(texto);
  });

  it('contraseña incorrecta → error claro', async () => {
    const sal = generarSal();
    const buena = await derivarClave('contraseña correcta 1', sal, IT);
    const mala = await derivarClave('contraseña incorrecta', sal, IT);
    const sobre = await cifrar(buena, 'secreto', { sal, iteraciones: IT });
    await expect(descifrar(mala, sobre)).rejects.toBeInstanceOf(ErrorCifrado);
  });

  it('detecta datos manipulados', async () => {
    const sal = generarSal();
    const clave = await derivarClave('frase de prueba larga', sal, IT);
    const sobre = await cifrar(clave, 'importe: 100', { sal, iteraciones: IT });
    const bytes = atob(sobre.datos);
    const alterado = btoa(bytes.slice(0, -1) + String.fromCharCode((bytes.charCodeAt(bytes.length - 1) + 1) % 256));
    await expect(descifrar(clave, { ...sobre, datos: alterado })).rejects.toThrow(/contraseña/);
  });

  it('cada cifrado usa un IV distinto', async () => {
    const sal = generarSal();
    const clave = await derivarClave('frase de prueba larga', sal, IT);
    const a = await cifrar(clave, 'igual', { sal, iteraciones: IT });
    const b = await cifrar(clave, 'igual', { sal, iteraciones: IT });
    expect(a.cifrado.iv).not.toBe(b.cifrado.iv);
  });

  it('rechaza sobres con formato inválido o de versión futura', () => {
    expect(() => leerSobre('no es json')).toThrow(ErrorCifrado);
    expect(() => leerSobre('{"app":"otra"}')).toThrow(/formato/);
    const futuro = { app: 'finanzas-sync', v: 99, kdf: { alg: 'PBKDF2-SHA256', iteraciones: 1, sal: 'a' }, cifrado: { alg: 'AES-GCM', iv: 'a' }, comp: 'gzip', datos: '' };
    expect(() => leerSobre(JSON.stringify(futuro))).toThrow(/versión/);
  });

  it('valida la contraseña', () => {
    expect(validarContrasena('corta')).not.toBeNull();
    expect(validarContrasena('suficientemente larga', 'otra cosa')).toMatch(/coinciden/);
    expect(validarContrasena('suficientemente larga', 'suficientemente larga')).toBeNull();
  });
});
