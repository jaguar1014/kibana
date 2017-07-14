import Fn from '../fn.js';
import { findInObject } from '../../lib/find_in_object';
import math from 'mathjs';
import moment from 'moment';
import { groupBy, zipObject, uniqBy, omit, pickBy, find, uniq, map, mapValues } from 'lodash';
import { getMathjsScope } from '../math/get_mathjs_scope';

function isColumnReference(mathExpression) {
  const parsedMath = math.parse(mathExpression);
  if (parsedMath.type === 'SymbolNode') return true;
}

function isMeasure(mathScope, mathExpression) {
  if (isColumnReference(mathExpression)) return false;

  const parsedMath = math.parse(mathExpression);

  if (parsedMath.type !== 'FunctionNode' && parsedMath.type !== 'ConstantNode') {
    throw new Error ('Expressions must be wrapped in a function such as sum()');
  }

  if (parsedMath.type !== 'ConstantNode') return true;

  // This will throw if the field isn't found on scope.
  // Must be a function node!
  const evaluated = math.eval(mathExpression, mathScope);
  if (typeof evaluated !== 'number') return false;

  return true;
}

function getFieldType(columns, field) {
  if (!field) return 'null';
  return find(columns, { name: field }).type;
}

function getType(columns, mathExpression) {
  if (isColumnReference(mathExpression)) return getFieldType(columns, mathExpression);

  const parsedMath = math.parse(mathExpression);
  const symbolNames = map(findInObject(parsedMath, (val, name) => val.type === 'SymbolNode' && name !== 'fn'), 'name');
  const symbolTypes = uniq(symbolNames.map(field => getFieldType(columns, field)));
  return (symbolTypes.length === 1) ? symbolTypes[0] : 'string';
}

module.exports = new Fn({
  name: 'pointseries',
  type: 'pointseries',
  help: 'Turn a datatable into a point series model. Dimensions are combined to create unique keys. Measures are then ' +
  'deduplicated by those keys.',
  context: {
    types: ['datatable'],
  },
  args: {
    // Dimensions
    x: {
      types: ['string', 'null'],
      help: 'A mathmatic expression that returns the values for a dimension or measure',
    },
    color: {
      types: ['string', 'null'],
      help: 'A string representing the column name or a function that returns a number', // If you need categorization, transform the field.
    },
    // Metrics
    y: {
      types: ['string', 'null'],
      help: 'A static number, or a function (starts with a .) to use to aggregate when there are ' +
      'several points for the same x-axis value',
    },
    // Size only makes sense as a number
    size: {
      types: ['string', 'null'], // pointseries(size=.sum(profit))
      help: 'For use in charts that support it, a function that returns a number, eg .math() to use for calculating size',
    },
    // In the future it may make sense to add things like shape, or tooltip values, but I think what we have is good for now
  },
  fn: (context, args) => {
    const mathScope = getMathjsScope(context);
    const dimensionNames = Object.keys(pickBy(args, val => !isMeasure(mathScope, val))).filter(arg => args[arg] != null);
    const measureNames = Object.keys(pickBy(args, val => isMeasure(mathScope, val)));
    const columns = mapValues(args, arg => {
      if (!arg) return;
      // TODO: We're setting the measure/dimension break down here, but it should probably come from the datatable right?
      return { type: getType(context.columns, arg), role: isMeasure(mathScope, arg) ? 'measure' : 'dimension' };
    });

    function normalizeValue(expression, value) {
      switch (getType(context.columns, expression)) {
        case 'string':
          return String(value);
        case 'number':
          return Number(value);
        case 'date':
          return moment(value).valueOf();
        default:
          return value;
      }
    }

    // Dimensions
    // Group rows by their dimension values, using the argument values and preserving the _rowId
    // There's probably a better way to do this
    const results = context.rows.reduce((acc, row, i) => {
      const newRow = dimensionNames.reduce((acc, dimension) => {
        const val = args[dimension];
        acc[dimension] = val ? normalizeValue(val, math.eval(val, mathScope)[i]) : '_all';
        return acc;
      }, { _rowId: row._rowId });

      return Object.assign(acc, { [row._rowId]: newRow });
      // acc[row._rowId] = newRow;
      // return acc;
    }, {});

    // Measures
    // First group up all of the distinct dimensioned bits. Each of these will be reduced to just 1 value
    // for each measure
    const measureDimensions = groupBy(context.rows, (row) => {
      const dimensions = dimensionNames.map(dimension => args[dimension] ? row[args[dimension]] : '_all');
      return dimensions.join('::%BURLAP%::');
    });

    // Then compute that 1 value for each measure
    Object.values(measureDimensions).forEach(rows => {
      const subtable = { type: 'datatable', columns: context.columns, rows: rows };
      const subScope = getMathjsScope(subtable);
      const measureValues = measureNames.map(measure => math.eval(args[measure], subScope));

      rows.forEach(row => {
        Object.assign(results[row._rowId], zipObject(measureNames, measureValues));
      });
    });

    // It only makes sense to uniq the rows in a point series as 2 values can not exist in the exact same place at the same time.
    const rows = uniqBy(Object.values(results), row => JSON.stringify(omit(row, '_rowId')));

    return {
      type: 'pointseries',
      columns: columns,
      rows: rows,
    };
  },
});
