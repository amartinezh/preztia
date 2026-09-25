import {
  splitForTelegram,
  whatsappMarkupToTelegramHtml as toHtml,
} from './telegram-markup';

describe('whatsappMarkupToTelegramHtml', () => {
  it('traduce negrita, cursiva y tachado', () => {
    expect(toHtml('Comparte tu *ubicación* _ahora_ ~no~')).toBe(
      'Comparte tu <b>ubicación</b> <i>ahora</i> <s>no</s>',
    );
  });

  it('escapa los caracteres especiales de HTML', () => {
    expect(toHtml('Cuota < 50.000 & saldo > 0')).toBe(
      'Cuota &lt; 50.000 &amp; saldo &gt; 0',
    );
  });

  it('no inyecta etiquetas provenientes del texto', () => {
    expect(toHtml('<b>hola</b>')).toBe('&lt;b&gt;hola&lt;/b&gt;');
  });

  it('respeta la puntuación y los emojis alrededor del marcado', () => {
    expect(toHtml('¡*Listo*! ✅ (_hoy_).')).toBe(
      '¡<b>Listo</b>! ✅ (<i>hoy</i>).',
    );
  });

  it.each([
    ['snake_case', 'la llave pix_key_2 es'],
    ['producto', '2*3*4 = 24'],
    ['correo', 'escribe a ana_maria@correo.co'],
    ['marcador con espacio interior', 'a * b * c'],
    ['marcador sin cerrar', 'solo *una estrella'],
  ])(
    'no convierte marcadores dentro de palabras o sin cerrar (%s)',
    (_, text) => {
      expect(toHtml(text)).toBe(text);
    },
  );

  it('no interpreta el marcado dentro de código', () => {
    expect(toHtml('Copia `00020126*PIX*` y paga')).toBe(
      'Copia <code>00020126*PIX*</code> y paga',
    );
    expect(toHtml('```a < b *c*```')).toBe('<pre>a &lt; b *c*</pre>');
  });

  it('traduce varias líneas de un menú', () => {
    expect(toHtml('*1)* Diario\n*2)* Semanal')).toBe(
      '<b>1)</b> Diario\n<b>2)</b> Semanal',
    );
  });
});

describe('splitForTelegram', () => {
  it('no parte un texto que cabe', () => {
    expect(splitForTelegram('hola', 10)).toEqual(['hola']);
  });

  it('conserva un texto vacío como un único mensaje', () => {
    expect(splitForTelegram('', 10)).toEqual(['']);
  });

  it('corta por párrafo antes que por línea o espacio', () => {
    expect(splitForTelegram('aaaa bbbb\n\ncccc', 12)).toEqual([
      'aaaa bbbb',
      'cccc',
    ]);
  });

  it('corta por espacio sin partir palabras', () => {
    expect(splitForTelegram('uno dos tres cuatro', 8)).toEqual([
      'uno dos',
      'tres',
      'cuatro',
    ]);
  });

  it('parte una palabra más larga que el límite', () => {
    expect(splitForTelegram('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('ningún fragmento excede el límite y no se pierde texto', () => {
    const text = Array.from({ length: 300 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = splitForTelegram(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
});
