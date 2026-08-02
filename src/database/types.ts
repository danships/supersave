export interface Relation {
  name: string;
  namespace?: string;
  field: string;
  multiple: boolean;
}

export type FilterSortField = 'string' | 'number' | 'boolean';

export interface EntityDefinition {
  name: string;
  template: Record<string, unknown>;
  relations: Relation[];
  namespace?: string;
  filterSortFields?: Record<string, FilterSortField>;
}

export interface BaseEntity {
  id?: string;

  [key: string]: any;
}
export interface EntityRow {
  id: string;
  contents: string;

  [key: string]: any;
}

export enum QueryOperatorEnum {
  EQUALS = '=',
  GREATER_THAN = '>',
  GREATER_THAN_EQUALS = '>=',
  LESS_THAN = '<',
  LESS_THAN_EQUALS = '<=',
  IN = 'IN',
  LIKE = 'LIKE',
}

export enum LogicalOperatorEnum {
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
}

export interface LogicalGroup {
  logicalOperator: LogicalOperatorEnum;
  conditions: QueryCondition[];
}

export type QueryCondition = QueryFilter | LogicalGroup;

export type QueryFilter = {
  operator: QueryOperatorEnum;
  field: string;
  value: QueryFilterValue;
};

export type QuerySort = {
  field: string;
  direction: 'asc' | 'desc';
};

export type QueryFilterValue = string | number | any;
