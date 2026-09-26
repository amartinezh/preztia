import { csvCell, toCsv } from './csv';

describe('csvCell', () => {
  it('deja intacto el texto normal y entrecomilla comas, comillas y saltos de línea', () => {
    expect(csvCell('Gasolina')).toBe('Gasolina');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
  });

  it('neutraliza fórmulas de hoja de cálculo (inyección CSV)', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});

describe('toCsv', () => {
  it('une encabezado y filas', () => {
    expect(toCsv(['a', 'b'], [['1', 'x,y']])).toBe('a,b\n1,"x,y"');
  });
});
