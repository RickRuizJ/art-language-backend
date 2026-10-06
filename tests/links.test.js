const { buildLinkResource, LinkError } = require('../src/utils/links');

describe('buildLinkResource', () => {
  it('acepta cualquier http(s), también sin protocolo', () => {
    expect(buildLinkResource('https://quizlet.com/set/123').embedUrl).toBeNull();
    expect(buildLinkResource('www.example.com/ejercicio').originalUrl).toBe('https://www.example.com/ejercicio');
  });
  it('rechaza esquemas peligrosos y vacíos', () => {
    ['javascript:alert(1)', 'data:text/html,x', 'ftp://a.com/x', ''].forEach(u =>
      expect(() => buildLinkResource(u)).toThrow(LinkError));
  });
  it('incrusta YouTube, Vimeo y Google', () => {
    expect(buildLinkResource('https://youtu.be/abc').embedUrl).toBe('https://www.youtube.com/embed/abc');
    expect(buildLinkResource('https://www.youtube.com/watch?v=abc&t=3').embedUrl).toBe('https://www.youtube.com/embed/abc');
    expect(buildLinkResource('https://vimeo.com/123').embedUrl).toBe('https://player.vimeo.com/video/123');
    expect(buildLinkResource('https://docs.google.com/document/d/D1/edit').embedUrl).toBe('https://docs.google.com/document/d/D1/preview');
    expect(buildLinkResource('https://docs.google.com/presentation/d/P1/edit').embedUrl).toBe('https://docs.google.com/presentation/d/P1/embed');
  });
});
