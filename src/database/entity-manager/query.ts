import type {
  FilterSortField,
  QueryFilter,
  QueryFilterValue,
  QuerySort,
} from '../types.js';
import { QueryOperatorEnum } from '../types.js';

class Query {
  private where: QueryFilter[] = [];

  private sortValues: QuerySort[] = [];

  private limitValue?: number;

  private offsetValue?: number;

  constructor(
    private readonly filterSortFields: Record<string, FilterSortField>
  ) {}

  private addFilter(
    operator: QueryOperatorEnum,
    field: string,
    value: QueryFilterValue
  ): Query {
    if (typeof this.filterSortFields[field] === 'undefined') {
      throw new TypeError(`Cannot filter on not defined field ${field}.`);
    }
    this.where.push({ operator, field, value });
    return this;
  }

  public eq(field: string, value: QueryFilterValue): Query {
    return this.addFilter(QueryOperatorEnum.EQUALS, field, value);
  }

  public gt(field: string, value: QueryFilterValue): Query {
    return this.addFilter(QueryOperatorEnum.GREATER_THAN, field, value);
  }

  public gte(field: string, value: QueryFilterValue): Query {
    return this.addFilter(QueryOperatorEnum.GREATER_THAN_EQUALS, field, value);
  }

  public lt(field: string, value: QueryFilterValue): Query {
    return this.addFilter(QueryOperatorEnum.LESS_THAN, field, value);
  }

  public lte(field: string, value: QueryFilterValue): Query {
    return this.addFilter(QueryOperatorEnum.LESS_THAN_EQUALS, field, value);
  }

  public like(field: string, value: string): Query {
    return this.addFilter(QueryOperatorEnum.LIKE, field, value);
  }

  public in(field: string, value: string[]): Query {
    return this.addFilter(QueryOperatorEnum.IN, field, value);
  }

  public getWhere(): QueryFilter[] {
    return this.where;
  }

  public limit(limit: number | undefined): Query {
    this.limitValue = limit;
    return this;
  }

  public getLimit(): number | undefined {
    return this.limitValue;
  }

  public offset(offset: number): Query {
    this.offsetValue = offset;
    return this;
  }

  public getOffset(): number | undefined {
    return this.offsetValue;
  }

  public sort(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    if (typeof this.filterSortFields[field] === 'undefined') {
      throw new TypeError(`Requested sort field ${field} is not defined.`);
    }
    this.sortValues.push({ field, direction });
    return this;
  }

  public getSort(): QuerySort[] {
    return this.sortValues;
  }
}

export default Query;
