import { parseFeed } from './rss-parser';

describe('parseFeed', () => {
  it('devuelve [] ante entrada vacía o basura (no lanza)', () => {
    expect(parseFeed('', 'X')).toEqual([]);
    expect(parseFeed('<rss><channel></channel></rss>', 'X')).toEqual([]);
    expect(parseFeed('<item><title>sin cierre', 'X')).toEqual([]);
  });

  it('extrae un item RSS con CDATA, entidades y fecha normalizada a ISO', () => {
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Banco Central & PIX <b>crece</b>]]></title>
          <link>https://portal.example/noticia-1?a=1&amp;b=2</link>
          <pubDate>Wed, 25 Jun 2025 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
    const [item] = parseFeed(xml, 'Economía');

    // Invariante: CDATA y HTML incrustado removidos; entidades decodificadas.
    expect(item.title).toBe('Banco Central & PIX crece');
    expect(item.link).toBe('https://portal.example/noticia-1?a=1&b=2');
    expect(item.source).toBe('Economía'); // sin <source> → usa el fallback
    expect(item.publishedAt).toBe('2025-06-25T10:00:00.000Z');
  });

  it('atribuye el medio del <source> por encima del fallback', () => {
    const xml = `<rss><channel><item>
      <title>Titular</title>
      <link>https://x.example/1</link>
      <source url="https://medio.example">Medio Confiável</source>
    </item></channel></rss>`;
    expect(parseFeed(xml, 'Sector')[0].source).toBe('Medio Confiável');
  });

  it('parsea Atom con <link href> y <published>', () => {
    const xml = `
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>Fintech avança no Brasil</title>
          <link rel="alternate" href="https://atom.example/post"/>
          <published>2025-06-20T08:30:00Z</published>
        </entry>
      </feed>`;
    const [item] = parseFeed(xml, 'Fintech');
    expect(item.title).toBe('Fintech avança no Brasil');
    expect(item.link).toBe('https://atom.example/post');
    expect(item.publishedAt).toBe('2025-06-20T08:30:00.000Z');
  });

  it('descarta ítems sin título o sin enlace', () => {
    const xml = `<rss><channel>
      <item><link>https://x.example/1</link></item>
      <item><title>Sin enlace</title></item>
      <item><title>Válido</title><link>https://x.example/ok</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, 'X');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Válido');
  });

  it('deja publishedAt en null si la fecha es inválida o ausente', () => {
    const xml = `<rss><channel>
      <item><title>A</title><link>https://x.example/a</link><pubDate>no-es-fecha</pubDate></item>
      <item><title>B</title><link>https://x.example/b</link></item>
    </channel></rss>`;
    const items = parseFeed(xml, 'X');
    expect(items[0].publishedAt).toBeNull();
    expect(items[1].publishedAt).toBeNull();
  });
});
