import { describe, it, expect } from 'vitest';
import { render } from '../infrastructure/template-engine';
import { loadTemplateConfig } from '../config';
import { TemplateValidationError } from '../domain/errors';

describe('render', () => {
  const invited = loadTemplateConfig().find((e) => e.event === 'identity.user.invited')!;

  it('renderiza el correo con el payload correcto', () => {
    const result = render(invited, {
      email: 'user@example.com',
      organizationName: 'Acme',
      inviteUrl: 'http://localhost/invite/abc',
    });
    expect(result.to).toBe('user@example.com');
    expect(result.subject).toContain('Acme');
    expect(result.html).toContain('Acme');
    expect(result.html.length).toBeGreaterThan(0);
  });

  it('lanza TemplateValidationError si falta un campo requerido', () => {
    expect(() =>
      render(invited, { email: 'user@example.com' } as any),
    ).toThrow(TemplateValidationError);
  });
});
