import { has } from 'lodash';
import { decamelize, decamelizeKeys, camelize, pascalize } from 'humps';
import knexnest from 'knexnest';
import parseFields from 'graphql-parse-fields';

import { selectBy, orderedFor } from './helpers';
import FieldError from '../../../common/FieldError';
import knex from './connector';

export default class Crud {
  getPrefix() {
    return this.prefix;
  }

  getTableName() {
    return this.tableName;
  }

  getSchema() {
    return this.schema;
  }

  _getList({ limit, offset, orderBy, filter }, info) {
    const baseQuery = knex(`${this.prefix}${this.tableName} as ${this.tableName}`);
    const select = selectBy(this.schema, info, false, this.prefix);
    const queryBuilder = select(baseQuery);

    if (limit) {
      queryBuilder.limit(limit);
    }

    if (offset) {
      queryBuilder.offset(offset);
    }

    if (orderBy && orderBy.column) {
      let column = orderBy.column;
      let order = 'asc';
      if (orderBy.order) {
        order = orderBy.order;
      }

      for (const key of this.schema.keys()) {
        if (column === key) {
          const value = this.schema.values[key];
          if (value.type.isSchema) {
            let sortBy = 'name';
            for (const remoteKey of value.type.keys()) {
              const remoteValue = value.type.values[remoteKey];
              if (remoteValue.sortBy) {
                sortBy = remoteKey;
              }
            }
            column = `${decamelize(value.type.name)}.${sortBy}`;
          } else {
            column = `${this.tableName}.${decamelize(column)}`;
          }
        }
      }

      queryBuilder.orderBy(column, order);
    } else {
      queryBuilder.orderBy(`${this.tableName}.id`);
    }

    if (filter) {
      if (has(filter, 'searchText') && filter.searchText !== '') {
        const schema = this.schema;
        const tableName = this.tableName;
        queryBuilder.where(function() {
          for (const key of schema.keys()) {
            const value = schema.values[key];
            if (value.searchText) {
              this.orWhere(`${tableName}.${key}`, 'like', `%${filter.searchText}%`);
            }
          }
        });
      }
    }

    return knexnest(queryBuilder);
  }

  async getPaginated(args, info) {
    const edges = await this._getList(args, parseFields(info).edges);
    const { count } = await this.getTotal();

    return {
      edges,
      pageInfo: {
        totalCount: count,
        hasNextPage: edges && edges.length === args.limit
      }
    };
  }

  getList(args, info) {
    return this._getList(args, parseFields(info));
  }

  getTotal() {
    return knex(`${this.prefix}${this.tableName}`)
      .countDistinct('id as count')
      .first();
  }

  _get({ where }, info) {
    const { id } = where;

    const baseQuery = knex(`${this.prefix}${this.tableName} as ${this.tableName}`);
    const select = selectBy(this.schema, info, true, this.prefix);
    return knexnest(select(baseQuery).where(`${this.tableName}.id`, '=', id));
  }

  async get(args, info) {
    const node = await this._get(args, parseFields(info).node);
    return { node };
  }

  _create(data) {
    return knex(`${this.prefix}${this.tableName}`)
      .insert(decamelizeKeys(data))
      .returning('id');
  }

  async create({ data }, ctx, info) {
    try {
      const e = new FieldError();
      e.throwIf();

      // extract nested entries from data
      let nestedEntries = [];
      for (const key of this.schema.keys()) {
        const value = this.schema.values[key];
        if (value.type.constructor === Array && data[key]) {
          nestedEntries.push({ key, data: data[key] });
          delete data[key];
        }
      }

      const [id] = await this._create(data);

      // create nested entries
      if (nestedEntries.length > 0) {
        nestedEntries.map(nested => {
          if (nested.data.create) {
            nested.data.create.map(async create => {
              create[`${camelize(this.schema.name)}Id`] = id;
              await ctx[pascalize(nested.key)]._create(create);
            });
          }
        });
      }

      return await this.get({ where: { id } }, info);
    } catch (e) {
      return { errors: e };
    }
  }

  _update({ data, where }) {
    return knex(`${this.prefix}${this.tableName}`)
      .update(decamelizeKeys(data))
      .where(where);
  }

  async update(args, ctx, info) {
    try {
      const e = new FieldError();
      e.throwIf();

      // extract nested entries from data
      let nestedEntries = [];
      for (const key of this.schema.keys()) {
        const value = this.schema.values[key];
        if (value.type.constructor === Array && args.data[key]) {
          nestedEntries.push({ key, data: args.data[key] });
          delete args.data[key];
        }
      }

      await this._update(args);

      // create, update, delete nested entries
      if (nestedEntries.length > 0) {
        nestedEntries.map(nested => {
          if (nested.data.create) {
            nested.data.create.map(async create => {
              create[`${camelize(this.schema.name)}Id`] = args.where.id;
              await ctx[pascalize(nested.key)]._create(create);
            });
          }
          if (nested.data.update) {
            nested.data.update.map(async update => {
              await ctx[pascalize(nested.key)]._update(update);
            });
          }
          if (nested.data.delete) {
            nested.data.delete.map(async where => {
              await ctx[pascalize(nested.key)]._delete({ where });
            });
          }
        });
      }

      return await this.get(args, info);
    } catch (e) {
      return { errors: e };
    }
  }

  _delete({ where }) {
    return knex(`${this.prefix}${this.tableName}`)
      .where(where)
      .del();
  }

  async delete(args, info) {
    try {
      const e = new FieldError();

      const node = await this.get(args, info);

      if (!node) {
        e.setError('delete', 'Node does not exist.');
        e.throwIf();
      }

      const isDeleted = await this._delete(args);

      if (isDeleted) {
        return node;
      } else {
        e.setError('delete', 'Could not delete Node. Please try again later.');
        e.throwIf();
      }
    } catch (e) {
      return { errors: e };
    }
  }

  _sort({ data }) {
    return knex.raw(
      `UPDATE ${this.prefix}${this.tableName} t1
        JOIN ${this.prefix}${this.tableName} t2
        ON t1.id = ? AND t2.id = ?
        SET t1.rank = ?,
        t2.rank = ?`,
      data
    );
  }

  async sort(args) {
    try {
      const e = new FieldError();
      e.throwIf();

      const [sortCount] = await this._sort(args);

      if (sortCount.affectedRows > 0) {
        return { count: sortCount.affectedRows };
      } else {
        e.setError('sort', 'Could not sort Node. Please try again later.');
        e.throwIf();
      }
    } catch (e) {
      return { errors: e };
    }
  }

  _updateMany({ data, where: { id_in } }) {
    console.log('_updateMany: data: ', data);
    console.log('_updateMany: id_in: ', id_in);
    //return knex(`${this.prefix}${this.tableName}`)
    //  .whereIn('id', id_in)
    //  .del();
  }

  async updateMany(args) {
    try {
      console.log('updateMany: ', args);
      const e = new FieldError();
      e.setError('update', 'Not yet implemented. Please try again later.');
      /*const deleteCount = await this._updateMany(args);

      if (deleteCount > 0) {
        return { count: deleteCount };
      } else {
        e.setError('delete', 'Could not delete any of selected Node. Please try again later.');
        e.throwIf();
      }*/
    } catch (e) {
      return { errors: e };
    }
  }

  _deleteMany({ where: { id_in } }) {
    return knex(`${this.prefix}${this.tableName}`)
      .whereIn('id', id_in)
      .del();
  }

  async deleteMany(args) {
    try {
      const e = new FieldError();

      const deleteCount = await this._deleteMany(args);

      if (deleteCount > 0) {
        return { count: deleteCount };
      } else {
        e.setError('delete', 'Could not delete any of selected Node. Please try again later.');
        e.throwIf();
      }
    } catch (e) {
      return { errors: e };
    }
  }

  async getByIds(ids, by, Obj, info) {
    info = parseFields(info);
    info[`${by}Id`] = true;
    const baseQuery = knex(`${Obj.getPrefix()}${Obj.getTableName()} as ${Obj.getTableName()}`);
    const select = selectBy(Obj.getSchema(), info, false, Obj.getPrefix());
    const res = await knexnest(select(baseQuery).whereIn(`${Obj.getTableName()}.${decamelize(by)}_id`, ids));
    return orderedFor(res, ids, `${by}Id`, false);
  }
}