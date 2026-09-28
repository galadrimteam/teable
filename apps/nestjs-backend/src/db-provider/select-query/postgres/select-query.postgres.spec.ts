/* eslint-disable sonarjs/no-duplicate-string */
import {
  CellValueType,
  DateFieldCore,
  DbFieldType,
  FieldType,
  NumberFieldCore,
  SingleLineTextFieldCore,
  TableDomain,
} from '@teable/core';
import type { FieldCore } from '@teable/core';
import knex from 'knex';
import { describe, expect, it } from 'vitest';

import { PostgresProvider } from '../../postgres.provider';
import { getDefaultDatetimeParsePattern } from '../../utils/default-datetime-parse-pattern';
import { SelectQueryPostgres } from './select-query.postgres';

describe('SelectQueryPostgres tzWrap', () => {
  it('sanitizes text-like datetime inputs even when SQL contains timestamp tokens', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'string', isFieldReference: false }] as unknown as never);

    const expr =
      "CONCAT(TO_CHAR(TIMEZONE('Etc/GMT-8', (col)::timestamptz), 'YYYY-MM-DD'), ' ', col2)";
    const sql = query.datetimeFormat(expr, "'HH:mm:ss'");

    expect(sql).toContain('BTRIM');
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain(getDefaultDatetimeParsePattern());
  });

  it('does not sanitize trusted datetime inputs', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'datetime', isFieldReference: false }] as unknown as never);

    const sql = query.datetimeFormat('col', "'HH:mm:ss'");
    expect(sql).not.toContain('BTRIM');
  });

  it('reparses trusted datetime inputs through custom formats instead of returning the original value', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'datetime', isFieldReference: false }] as unknown as never);

    const sql = query.datetimeParse('col', "'MMYYYY'");

    expect(sql).toContain('TO_CHAR');
    expect(sql).toContain('TO_TIMESTAMP');
    expect(sql).toContain(`AT TIME ZONE 'Asia/Shanghai'`);
    expect(sql).not.toBe('(col)');
  });
});

describe('SelectQueryPostgres truthinessScore', () => {
  it('casts boolean-like expressions before COALESCE to avoid text/boolean type errors', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([{ type: 'boolean', isFieldReference: false }] as unknown as never);

    const sql = query.if("('true')::text", "'yes'", "'no'");
    expect(sql).toContain("COALESCE((('true')::text)::boolean, FALSE)");
  });

  it('coerces json-like numeric branches in IF to avoid CASE jsonb/integer mismatches', () => {
    const query = new SelectQueryPostgres();
    query.setContext({
      timeZone: 'Asia/Shanghai',
      targetDbFieldType: DbFieldType.Real,
    } as unknown as never);
    query.setCallMetadata([
      { type: 'string', isFieldReference: false },
      {
        type: 'string',
        isFieldReference: true,
        field: {
          id: 'fldJsonNumeric',
          isMultiple: true,
          isLookup: true,
          dbFieldName: '__json_numeric',
          dbFieldType: DbFieldType.Json,
          cellValueType: 'number',
        },
      },
      { type: 'number', isFieldReference: false },
    ] as unknown as never);

    const sql = query.if('__cond', '"__json_numeric"', '0');
    expect(sql).toContain('to_jsonb("__json_numeric")');
    expect(sql).toContain('jsonb_array_elements_text');
    expect(sql).toContain('double precision');
  });
});

describe('SelectQueryPostgres boolean IF', () => {
  const field = <T extends FieldCore>(
    core: T,
    id: string,
    dbFieldName: string,
    type: FieldType,
    cellValueType: CellValueType,
    options: T['options']
  ): T => {
    Object.assign(core, {
      id,
      name: id,
      dbFieldName,
      type,
      cellValueType,
      options,
      isMultipleCellValue: false,
      isLookup: false,
    });
    core.updateDbFieldType();
    return core;
  };

  const table = new TableDomain({
    id: 'tblBooleanIf',
    name: 'Boolean IF',
    dbTableName: 'public.tbl_boolean_if',
    lastModifiedTime: '2026-09-28T00:00:00.000Z',
    fields: [
      field(
        new DateFieldCore(),
        'fldDate',
        'Date_Dev',
        FieldType.Date,
        CellValueType.DateTime,
        DateFieldCore.defaultOptions()
      ),
      field(
        new NumberFieldCore(),
        'fldNumber',
        'Reel',
        FieldType.Number,
        CellValueType.Number,
        NumberFieldCore.defaultOptions()
      ),
      field(
        new SingleLineTextFieldCore(),
        'fldText',
        'Title',
        FieldType.SingleLineText,
        CellValueType.String,
        SingleLineTextFieldCore.defaultOptions()
      ),
    ],
  });

  const provider = new PostgresProvider(knex({ client: 'pg' }));
  const toSql = (expression: string, targetDbFieldType: DbFieldType) => {
    const result = provider.convertFormulaToSelectQuery(expression, {
      table,
      selectionMap: new Map(),
      tableAlias: 'main',
      timeZone: 'UTC',
      targetDbFieldType,
    });
    return typeof result === 'string' ? result : result.toQuery();
  };

  it.each([
    ['IF({fldDate}, FALSE, TRUE)', / THEN \(FALSE\)::boolean ELSE \(TRUE\)::boolean END$/],
    ['IF({fldNumber}, TRUE, FALSE)', / THEN \(TRUE\)::boolean ELSE \(FALSE\)::boolean END$/],
    ['IF({fldText}, TRUE, FALSE)', / THEN \(TRUE\)::boolean ELSE \(FALSE\)::boolean END$/],
    ['IF({fldText} = "x", TRUE, BLANK())', / THEN \(TRUE\)::boolean ELSE NULL END$/],
    ['IF({fldText} = "x", BLANK(), FALSE)', / THEN NULL ELSE \(FALSE\)::boolean END$/],
  ])('keeps the boolean branches of %s boolean', (expression, branches) => {
    expect(toSql(expression, DbFieldType.Boolean)).toMatch(branches);
  });

  it('keeps numeric branches numeric', () => {
    expect(toSql('IF({fldDate}, 1, 0)', DbFieldType.Real)).toMatch(
      / THEN \(1\)::double precision ELSE \(0\)::double precision END$/
    );
  });

  it('keeps a boolean mixed with a number on the numeric path', () => {
    expect(toSql('IF({fldDate}, {fldNumber}, TRUE)', DbFieldType.Text)).toContain(
      'THEN 1 ELSE 0 END)::double precision END'
    );
  });
});

describe('SelectQueryPostgres countAll', () => {
  it('counts JSON array length for multi-value field references', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ tableAlias: 't' } as unknown as never);
    query.setCallMetadata([
      {
        type: 'string',
        isFieldReference: true,
        field: {
          id: 'fldUsers',
          isMultiple: true,
          isLookup: false,
          dbFieldName: '__users',
          dbFieldType: DbFieldType.Json,
          cellValueType: 'string',
        },
      },
    ] as unknown as never);

    const sql = query.countAll('(SELECT json_agg(x) FROM x)');
    expect(sql).toContain('jsonb_array_length');
    expect(sql).toContain(`"t"."__users"`);
  });

  it('uses scalar null-check semantics for non-json fields', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ tableAlias: 't' } as unknown as never);
    query.setCallMetadata([
      {
        type: 'number',
        isFieldReference: true,
        field: {
          id: 'fldNum',
          isMultiple: false,
          isLookup: false,
          dbFieldName: '__num',
          dbFieldType: DbFieldType.Real,
          cellValueType: 'number',
        },
      },
    ] as unknown as never);

    expect(query.countAll('"t"."__num"')).toBe('CASE WHEN "t"."__num" IS NULL THEN 0 ELSE 1 END');
  });
});

describe('SelectQueryPostgres FROMNOW/TONOW', () => {
  it('applies unit conversion for FROMNOW', () => {
    const query = new SelectQueryPostgres();

    const daySql = query.fromNow('NOW()', "'day'");
    const hourSql = query.fromNow('NOW()', "'hour'");
    const secondSql = query.fromNow('NOW()', "'second'");

    expect(daySql).toContain('/ 86400');
    expect(hourSql).toContain('/ 3600');
    expect(secondSql).not.toContain('/ 86400');
    expect(secondSql).not.toContain('/ 3600');
  });

  it('keeps TONOW direction as now minus date for past-positive semantics', () => {
    const query = new SelectQueryPostgres();

    const sql = query.toNow('date_col', "'day'");
    expect(sql).toContain('NOW() -');
    expect(sql).not.toContain('date_col::timestamp - NOW()');
  });
});

describe('SelectQueryPostgres workday', () => {
  it('generates CTE-based workday SQL that skips weekends and holidays', () => {
    const query = new SelectQueryPostgres();
    query.setContext({ timeZone: 'Asia/Shanghai' } as unknown as never);
    query.setCallMetadata([
      { type: 'datetime', isFieldReference: true },
      { type: 'number', isFieldReference: true },
    ] as unknown as never);

    const sql = query.workday('"t"."Date"', '"t"."Number"');
    expect(sql).toContain('WITH params AS');
    expect(sql).toContain('generate_series');
    expect(sql).toContain('EXTRACT(DOW FROM c.candidate_date)');
    expect(sql).toContain(`("t"."Number")::double precision`);
  });
});
