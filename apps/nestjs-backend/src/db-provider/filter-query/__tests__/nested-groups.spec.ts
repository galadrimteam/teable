import { CellValueType, DriverClient, FieldType, SingleLineTextFieldCore } from '@teable/core';
import type { FieldCore, IFilter } from '@teable/core';
import knex from 'knex';
import type { IDbProvider } from '../../db.provider.interface';
import { FilterQueryPostgres } from '../postgres/filter-query.postgres';

const knexBuilder = knex({ client: 'pg' });
const dbProviderStub = { driver: DriverClient.Pg } as unknown as IDbProvider;

const status = Object.assign(new SingleLineTextFieldCore(), {
  id: 'fldStatus',
  name: 'Status',
  dbFieldName: 'status',
  type: FieldType.SingleLineText,
  options: SingleLineTextFieldCore.defaultOptions(),
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
  isLookup: false,
});
status.updateDbFieldType();

const where = (filter: IFilter) => {
  const qb = knexBuilder('main_table as main');
  new FilterQueryPostgres(
    qb,
    { [status.id]: status as FieldCore },
    filter,
    undefined,
    dbProviderStub,
    {
      selectionMap: new Map([[status.id, '"main"."status"']]),
    }
  ).appendQueryBuilder();
  return qb
    .toQuery()
    .replace(/\s+/g, ' ')
    .replace(/^.* where /, '');
};

const item = (value: string) => ({ fieldId: status.id, operator: 'is' as const, value });

describe('nested filter groups', () => {
  it('joins a group with the conjunction of the group that holds it, at any depth', () => {
    const sql = where({
      conjunction: 'and',
      filterSet: [
        {
          conjunction: 'or',
          filterSet: [item('A'), { conjunction: 'and', filterSet: [item('B'), item('C')] }],
        },
        item('D'),
      ],
    });

    expect(sql).toMatch(/"status" = 'A' or \(\(.*"status" = 'B' and .*"status" = 'C'\)\)/);
    expect(sql).toMatch(/\) and .*"status" = 'D'/);
  });
});
