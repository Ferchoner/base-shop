import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { ConfigFrontendLinks } from './config-frontend-links.js';

function linksOn(
  shop: string,
  backoffice = 'https://admin.example.com',
): ConfigFrontendLinks {
  const values: Record<string, string> = {
    FRONTEND_BASE_URL: shop,
    BACKOFFICE_BASE_URL: backoffice,
  };
  const config = {
    get: (name: string) => values[name],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new ConfigFrontendLinks(config);
}

describe('ConfigFrontendLinks (ADR-0056, ADR-0110, ADR-0169)', () => {
  it('builds an absolute link with the parameters in the query string', () => {
    expect(
      linksOn('https://shop.example.com').link('shop', '/verify-email', {
        token: 'abc123',
      }),
    ).toBe('https://shop.example.com/verify-email?token=abc123');
  });

  it('builds the links of the backoffice on its own base URL', () => {
    const links = linksOn(
      'https://shop.example.com',
      'https://admin.example.com',
    );

    expect(links.link('backoffice', '/reset-password', { token: 't' })).toBe(
      'https://admin.example.com/reset-password?token=t',
    );
    expect(links.link('shop', '/reset-password', { token: 't' })).toBe(
      'https://shop.example.com/reset-password?token=t',
    );
  });

  it('keeps the path of the base URL', () => {
    expect(
      linksOn('https://example.com/tienda').link('shop', '/reset-password', {
        token: 't',
      }),
    ).toBe('https://example.com/tienda/reset-password?token=t');
    expect(
      linksOn('https://shop.example.com', 'https://example.com/admin').link(
        'backoffice',
        '/reset-password',
        { token: 't' },
      ),
    ).toBe('https://example.com/admin/reset-password?token=t');
  });

  it('encodes parameter values, so a token cannot change the link', () => {
    const link = linksOn('http://localhost:3002').link(
      'shop',
      '/verify-email',
      {
        token: 'a+b/c=&next=https://evil.example',
      },
    );

    expect(link).toBe(
      'http://localhost:3002/verify-email?token=a%2Bb%2Fc%3D%26next%3Dhttps%3A%2F%2Fevil.example',
    );
    expect(new URL(link).searchParams.get('token')).toBe(
      'a+b/c=&next=https://evil.example',
    );
  });

  it('builds a link without parameters', () => {
    expect(linksOn('https://shop.example.com').link('shop', '/account')).toBe(
      'https://shop.example.com/account',
    );
  });

  it('rejects a path without the leading slash, which would join the host name', () => {
    expect(() =>
      linksOn('https://shop.example.com').link('shop', 'evil.example'),
    ).toThrow('A frontend path starts with "/"');
    expect(() =>
      linksOn('https://shop.example.com').link('backoffice', 'evil.example'),
    ).toThrow('A frontend path starts with "/"');
  });
});
