import type {
  FilterSortField,
  QueryCondition,
  QueryFilter,
  QueryFilterValue,
  QuerySort,
} from '../types.js';
import { LogicalOperatorEnum, QueryOperatorEnum } from '../types.js';

class Query {
  private where: QueryCondition[] = [];

  private currentGroup?: {
    logicalOperator: LogicalOperatorEnum;
    conditions: QueryCondition[];
  };

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
    const filter: QueryFilter = { operator, field, value };

    if (this.currentGroup) {
      this.currentGroup.conditions.push(filter);
      if (this.currentGroup.logicalOperator === LogicalOperatorEnum.NOT) {
        this.finalizeGroup();
      }
    } else {
      this.where.push(filter);
    }
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

  private finalizeGroup(): void {
    if (this.currentGroup) {
      this.where.push({
        logicalOperator: this.currentGroup.logicalOperator,
        conditions: this.currentGroup.conditions,
      });
      this.currentGroup = undefined;
    }
  }

  public and(...queries: Query[]): Query {
    this.finalizeGroup();
    if (queries.length > 0) {
      const conditions = queries.flatMap((q) => q.getWhere());
      this.where.push({
        logicalOperator: LogicalOperatorEnum.AND,
        conditions,
      });
    } else {
      this.currentGroup = {
        logicalOperator: LogicalOperatorEnum.AND,
        conditions: [],
      };
    }
    return this;
  }

  public or(...queries: Query[]): Query {
    this.finalizeGroup();
    if (queries.length > 0) {
      const conditions = queries.flatMap((q) => q.getWhere());
      this.where.push({
        logicalOperator: LogicalOperatorEnum.OR,
        conditions,
      });
    } else {
      this.currentGroup = {
        logicalOperator: LogicalOperatorEnum.OR,
        conditions: [],
      };
    }
    return this;
  }

  public not(): Query {
    this.finalizeGroup();
    this.currentGroup = {
      logicalOperator: LogicalOperatorEnum.NOT,
      conditions: [],
    };
    return this;
  }

  public getWhere(): QueryCondition[] {
    this.finalizeGroup();
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
