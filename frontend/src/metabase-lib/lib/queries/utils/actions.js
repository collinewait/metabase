import moment from "moment-timezone";

import { isDate, isNumber } from "metabase/lib/schema_metadata";

import { parseTimestamp } from "metabase/lib/time";
import {
  rangeForValue,
  fieldRefForColumn,
  fieldRefWithOption,
} from "metabase-lib/lib/queries/utils/dataset";

import StructuredQuery from "metabase-lib/lib/queries/StructuredQuery";
import { FieldDimension } from "metabase-lib/lib/Dimension";

export { drillDownForDimensions } from "./drilldown";

// QUESTION DRILL ACTIONS

export function aggregate(question, aggregation) {
  const query = question.query();
  if (query instanceof StructuredQuery) {
    return query.aggregate(aggregation).question().setDefaultDisplay();
  }
}

export function breakout(question, breakout) {
  const query = question.query();
  if (query instanceof StructuredQuery) {
    return query.breakout(breakout).question().setDefaultDisplay();
  }
}

// Adds a new filter with the specified operator, column, and value
export function filter(question, operator, column, value) {
  const query = question.query();
  if (query instanceof StructuredQuery) {
    return query
      .filter([operator, fieldRefForColumn(column), value])
      .question();
  }
}

export function pivot(question, breakouts = [], dimensions = []) {
  let query = question.query();
  if (query instanceof StructuredQuery) {
    for (const dimension of dimensions) {
      query = drillFilter(query, dimension.value, dimension.column);
      const dimensionRef = fieldRefForColumn(dimension.column);
      for (let i = 0; i < query.breakouts().length; i++) {
        const breakout = query.breakouts()[i];
        if (breakout.dimension().isSameBaseDimension(dimensionRef)) {
          query = breakout.remove();
          i--;
        }
      }
    }
    for (const breakout of breakouts) {
      query = query.breakout(breakout);
    }
    return query.question().setDefaultDisplay();
  }
}

export function distribution(question, column) {
  const query = question.query();
  if (query instanceof StructuredQuery) {
    const breakout = isDate(column)
      ? fieldRefWithOption(fieldRefForColumn(column), "temporal-unit", "month")
      : isNumber(column)
      ? fieldRefWithOption(fieldRefForColumn(column), "binning", {
          strategy: "default",
        })
      : fieldRefForColumn(column);
    return query
      .clearAggregations()
      .clearBreakouts()
      .clearSort()
      .clearLimit()
      .aggregate(["count"])
      .breakout(breakout)
      .question()
      .setDisplay("bar");
  }
}

// STRUCTURED QUERY UTILITIES

const fieldRefWithTemporalUnit = (mbqlClause, unit) => {
  const dimension = FieldDimension.parseMBQLOrWarn(mbqlClause);
  if (dimension) {
    return dimension.withTemporalUnit(unit).mbql();
  }
  return mbqlClause;
};

const fieldRefWithTemporalUnitForColumn = (column, unit) =>
  fieldRefWithTemporalUnit(fieldRefForColumn(column), unit);

export function drillFilter(query, value, column) {
  let filter;
  if (isDate(column)) {
    if (value == null) {
      filter = [
        "is-null",
        fieldRefWithTemporalUnitForColumn(column, column.unit),
      ];
    } else {
      filter = [
        "=",
        fieldRefWithTemporalUnitForColumn(column, column.unit),
        parseTimestamp(value, column.unit).format(),
      ];
    }
  } else {
    const range = rangeForValue(value, column);
    if (range) {
      filter = ["between", fieldRefForColumn(column), range[0], range[1]];
    } else if (value != null) {
      filter = ["=", fieldRefForColumn(column), value];
    } else {
      filter = ["is-null", fieldRefForColumn(column)];
    }
  }

  return addOrUpdateFilter(query, filter);
}

export function addOrUpdateFilter(query, newFilter) {
  // replace existing filter, if it exists
  for (const filter of query.filters()) {
    const dimension = filter.dimension();
    if (dimension && dimension.isSameBaseDimension(newFilter[1])) {
      return filter.replace(newFilter);
    }
  }
  // otherwise add a new filter
  return query.filter(newFilter);
}

// min number of points when switching units
const MIN_INTERVALS = 4;

const UNITS = ["minute", "hour", "day", "week", "month", "quarter", "year"];
const getNextUnit = unit => {
  return UNITS[Math.max(0, UNITS.indexOf(unit) - 1)];
};

export function addOrUpdateBreakout(query, newBreakout) {
  // replace existing breakout, if it exists
  for (const breakout of query.breakouts()) {
    if (breakout.dimension().isSameBaseDimension(newBreakout)) {
      return breakout.replace(newBreakout);
    }
  }
  // otherwise add a new breakout
  return query.breakout(newBreakout);
}

export function updateDateTimeFilter(query, column, start, end) {
  const fieldRef = fieldRefForColumn(column);
  start = moment(start);
  end = moment(end);
  if (column.unit) {
    // start with the existing breakout unit
    let unit = column.unit;

    // clamp range to unit to ensure we select exactly what's represented by the dots/bars
    start = start.add(1, unit).startOf(unit);
    end = end.endOf(unit);

    // find the largest unit with at least MIN_INTERVALS
    while (
      unit !== getNextUnit(unit) &&
      end.diff(start, unit) < MIN_INTERVALS
    ) {
      unit = getNextUnit(unit);
    }

    // update the breakout
    query = addOrUpdateBreakout(
      query,
      fieldRefWithTemporalUnit(fieldRef, unit),
    );

    // round to start of the original unit
    start = start.startOf(column.unit);
    end = end.startOf(column.unit);

    if (start.isAfter(end)) {
      return query;
    }
    if (start.isSame(end, column.unit)) {
      // is the start and end are the same (in whatever the original unit was) then just do an "="
      return addOrUpdateFilter(query, [
        "=",
        fieldRefWithTemporalUnit(fieldRef, column.unit),
        start.format(),
      ]);
    } else {
      // otherwise do a between
      return addOrUpdateFilter(query, [
        "between",
        fieldRefWithTemporalUnit(fieldRef, column.unit),
        start.format(),
        end.format(),
      ]);
    }
  } else {
    return addOrUpdateFilter(query, [
      "between",
      fieldRef,
      start.format(),
      end.format(),
    ]);
  }
}

export function updateLatLonFilter(
  query,
  latitudeColumn,
  longitudeColumn,
  bounds,
) {
  return addOrUpdateFilter(query, [
    "inside",
    fieldRefForColumn(latitudeColumn),
    fieldRefForColumn(longitudeColumn),
    bounds.getNorth(),
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
  ]);
}

export function updateNumericFilter(query, column, start, end) {
  const fieldRef = fieldRefForColumn(column);
  return addOrUpdateFilter(query, ["between", fieldRef, start, end]);
}
