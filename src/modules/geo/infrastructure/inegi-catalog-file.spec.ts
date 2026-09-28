import {
  parseCsv,
  parseInegiCatalog,
  UnreadableCatalogFileError,
} from './inegi-catalog-file.js';

const encode = (text: string) => new TextEncoder().encode(text);

/** Header and rows as the INEGI municipal catalog ships them: quoted fields, CRLF line ends. */
const INEGI_SAMPLE = [
  'CVEGEO,CVE_ENT,NOM_ENT,NOM_ABR,CVE_MUN,NOM_MUN,CVE_CAB,NOM_CAB,POB_TOTAL',
  '"09010","09","Ciudad de México","CDMX","010","Álvaro Obregón","----","","759137"',
  '"16053","16","Michoacán de Ocampo","Mich.","053","Morelia","0001","Morelia","849053"',
  '',
].join('\r\n');

describe('parseInegiCatalog (UC-IAM-21)', () => {
  it('reads the state and municipality of each row, with accents', () => {
    expect(parseInegiCatalog(encode(INEGI_SAMPLE))).toEqual([
      {
        stateCode: '09',
        stateName: 'Ciudad de México',
        municipalityCode: '09010',
        municipalityName: 'Álvaro Obregón',
      },
      {
        stateCode: '16',
        stateName: 'Michoacán de Ocampo',
        municipalityCode: '16053',
        municipalityName: 'Morelia',
      },
    ]);
  });

  it('ignores a byte order mark before the header', () => {
    const rows = parseInegiCatalog(encode(`﻿${INEGI_SAMPLE}`));

    expect(rows).toHaveLength(2);
  });

  it('rejects a file that is not UTF-8, such as the Latin-1 CSV of the same ZIP', () => {
    // "México" in Latin-1: é is the single byte 0xE9, invalid in UTF-8.
    const latin1 = Uint8Array.from([
      ...encode('CVE_ENT,NOM_ENT,CVE_MUN,NOM_MUN\r\n"09","M'),
      0xe9,
      ...encode('xico","010","Tlalpan"\r\n'),
    ]);

    expect(() => parseInegiCatalog(latin1)).toThrow(
      new UnreadableCatalogFileError(
        'The file is not UTF-8. Use the CSV whose name ends in _utf8.csv.',
      ),
    );
  });

  it('rejects a file without the catalog columns, such as the state catalog', () => {
    const states =
      'CVEGEO,CVE_ENT,NOM_ENT,NOM_ABR\r\n"01","01","Aguascalientes","Ags."';

    expect(() => parseInegiCatalog(encode(states))).toThrow(
      'The file lacks the columns CVE_MUN, NOM_MUN. Is it the INEGI municipal catalog?',
    );
  });

  it('rejects an empty file', () => {
    expect(() => parseInegiCatalog(encode(''))).toThrow('The file is empty.');
  });
});

describe('parseCsv (RFC 4180)', () => {
  it('keeps commas, doubled quotes and line breaks inside quoted fields', () => {
    expect(parseCsv('a,"b, c","say ""hi""","x\ny"\n1,2,3,4')).toEqual([
      ['a', 'b, c', 'say "hi"', 'x\ny'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('accepts LF and CRLF, empty fields and a last line without a line end', () => {
    expect(parseCsv('a,,c\r\n\r\nd,e,\nf,g,h')).toEqual([
      ['a', '', 'c'],
      ['d', 'e', ''],
      ['f', 'g', 'h'],
    ]);
  });

  it('rejects a file that ends inside a quoted field', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(UnreadableCatalogFileError);
  });
});
