import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { ConfigFrontendLinks } from './config-frontend-links.js';

function linksOn(baseUrl: string): ConfigFrontendLinks {
  const config = {
    get: () => baseUrl,
  } as unknown as ConfigService<EnvironmentVariables, true>;
  return new ConfigFrontendLinks(config);
}

describe('ConfigFrontendLinks (ADR-0056, ADR-0110)', () => {
  it('builds an absolute link with the parameters in the query string', () => {
    expect(
      linksOn('https://shop.example.com').link('/verify-email', {
        token: 'abc123',
      }),
    ).toBe('https://shop.example.com/verify-email?token=abc123');
  });

  it('keeps the path of the base URL', () => {
    expect(
      linksOn('https://example.com/tienda').link('/reset-password', {
        token: 't',
      }),
    ).toBe('https://example.com/tienda/reset-password?token=t');
  });

  it('encodes parameter values, so a token cannot change the link', () => {
    const link = linksOn('http://localhost:5173').link('/verify-email', {
      token: 'a+b/c=&next=https://evil.example',
    });

    expect(link).toBe(
      'http://localhost:5173/verify-email?token=a%2Bb%2Fc%3D%26next%3Dhttps%3A%2F%2Fevil.example',
    );
    expect(new URL(link).searchParams.get('token')).toBe(
      'a+b/c=&next=https://evil.example',
    );
  });

  it('builds a link without parameters', () => {
    expect(linksOn('https://shop.example.com').link('/account')).toBe(
      'https://shop.example.com/account',
    );
  });

  it('rejects a path without the leading slash, which would join the host name', () => {
    expect(() =>
      linksOn('https://shop.example.com').link('evil.example'),
    ).toThrow('A frontend path starts with "/"');
  });
});
