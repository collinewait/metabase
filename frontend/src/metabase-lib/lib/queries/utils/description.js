import React from "react";

import { t } from "ttag";
import _ from "underscore";
import inflection from "inflection";

import { stripId } from "metabase/lib/formatting";

import { format as formatExpression } from "metabase/lib/expressions/format";

import * as AGGREGATION from "./aggregation";
import * as QUERY from "./query";
import * as FIELD_REF from "./field-ref";
import { FilterClause, MetricClause } from "./description.styled";

// NOTE: This doesn't support every MBQL clause, e.x. joins. It should also be moved to StructuredQuery.

export function formatField(fieldDef, options = {}) {
  const name = stripId(fieldDef && (fieldDef.display_name || fieldDef.name));
  return name;
}

export function getFieldName(tableMetadata, field, options) {
  try {
    const target = FIELD_REF.getFieldTarget(field, tableMetadata);
    const components = [];
    if (target.path) {
      for (const fieldDef of target.path) {
        components.push(formatField(fieldDef, options), " → ");
      }
    }
    components.push(formatField(target.field, options));
    if (target.unit) {
      components.push(` (${target.unit})`);
    }
    return components;
  } catch (e) {
    console.warn(
      "Couldn't format field name for field",
      field,
      "in table",
      tableMetadata,
    );
  }
  return "[Unknown Field]";
}

export function getTableDescription(tableMetadata) {
  return [inflection.pluralize(tableMetadata.display_name)];
}

export function getAggregationDescription(tableMetadata, query, options) {
  return conjunctList(
    QUERY.getAggregations(query).map(aggregation => {
      if (AGGREGATION.hasOptions(aggregation)) {
        if (AGGREGATION.isNamed(aggregation)) {
          return [AGGREGATION.getName(aggregation)];
        }
        aggregation = AGGREGATION.getContent(aggregation);
      }
      if (AGGREGATION.isMetric(aggregation)) {
        const metric = _.findWhere(tableMetadata.metrics, {
          id: AGGREGATION.getMetric(aggregation),
        });
        const name = metric ? metric.name : "[Unknown Metric]";
        return [options.jsx ? <MetricClause>{name}</MetricClause> : name];
      }
      switch (aggregation[0]) {
        case "rows":
          return [t`Raw data`];
        case "count":
          return [t`Count`];
        case "cum-count":
          return [t`Cumulative count`];
        case "avg":
          return [
            t`Average of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "distinct":
          return [
            t`Distinct values of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "stddev":
          return [
            t`Standard deviation of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "sum":
          return [
            t`Sum of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "cum-sum":
          return [
            t`Cumulative sum of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "max":
          return [
            t`Maximum of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        case "min":
          return [
            t`Minimum of `,
            getFieldName(tableMetadata, aggregation[1], options),
          ];
        default:
          return [formatExpression(aggregation, { tableMetadata })];
      }
    }),
    "and",
  );
}

export function getBreakoutDescription(tableMetadata, { breakout }, options) {
  if (breakout && breakout.length > 0) {
    return [
      t`Grouped by `,
      joinList(
        breakout.map(b => getFieldName(tableMetadata, b, options)),
        " and ",
      ),
    ];
  }
}

export function getFilterDescription(tableMetadata, query, options) {
  // getFilters returns list of filters without the implied "and"
  const filters = ["and"].concat(QUERY.getFilters(query));
  if (filters && filters.length > 1) {
    return [
      t`Filtered by `,
      getFilterClauseDescription(tableMetadata, filters, options),
    ];
  }
}

export function getFilterClauseDescription(tableMetadata, filter, options) {
  if (filter[0] === "and" || filter[0] === "or") {
    const clauses = filter
      .slice(1)
      .map(f => getFilterClauseDescription(tableMetadata, f, options));
    return conjunctList(clauses, filter[0].toLowerCase());
  } else if (filter[0] === "segment") {
    const segment = _.findWhere(tableMetadata.segments, { id: filter[1] });
    const name = segment ? segment.name : "[Unknown Segment]";
    return options.jsx ? <FilterClause>{name}</FilterClause> : name;
  } else if (filter[0] === "between" && filter[1][0] === "+") {
    return getFieldName(tableMetadata, filter[1][1], options);
  } else {
    return getFieldName(tableMetadata, filter[1], options);
  }
}

export function getOrderByDescription(tableMetadata, query, options) {
  const orderBy = query["order-by"];
  if (orderBy && orderBy.length > 0) {
    return [
      t`Sorted by `,
      joinList(
        orderBy.map(([direction, field]) => {
          const name = FIELD_REF.isAggregateField(field)
            ? getAggregationDescription(tableMetadata, query, options)
            : getFieldName(tableMetadata, field, options);

          return (
            name + " " + (direction === "asc" ? "ascending" : "descending")
          );
        }),
        " and ",
      ),
    ];
  }
}

export function getLimitDescription(tableMetadata, { limit }) {
  if (limit != null) {
    return [limit, " ", inflection.inflect("row", limit)];
  }
}

export function generateQueryDescription(tableMetadata, query, options = {}) {
  if (!tableMetadata) {
    return "";
  }

  options = {
    jsx: false,
    sections: [
      "table",
      "aggregation",
      "breakout",
      "filter",
      "order-by",
      "limit",
    ],
    ...options,
  };

  const sectionFns = {
    table: getTableDescription,
    aggregation: getAggregationDescription,
    breakout: getBreakoutDescription,
    filter: getFilterDescription,
    "order-by": getOrderByDescription,
    limit: getLimitDescription,
  };

  // these array gymnastics are needed to support JSX formatting
  const sections = options.sections
    .map(section =>
      _.flatten(sectionFns[section](tableMetadata, query, options)).filter(
        s => !!s,
      ),
    )
    .filter(s => s && s.length > 0);

  const description = _.flatten(joinList(sections, ", "));
  if (options.jsx) {
    return <span>{description}</span>;
  } else {
    return description.join("");
  }
}

// -----------------------------------------------------------------------------
// These functions use the `query_description` field returned by the Segment and
// Metric APIs. They're meant for cases where you do not have the full database
// metadata available, and the server side will generate a data structure
// containing all the applicable data for formatting a user-friendly description
// of a query.
// -----------------------------------------------------------------------------

export function formatTableDescription({ table }, options = {}) {
  return [inflection.pluralize(table)];
}

export function formatAggregationDescription({ aggregation }, options = {}) {
  if (!aggregation || !aggregation.length) {
    return [];
  }

  return conjunctList(
    aggregation.map(agg => {
      switch (agg["type"]) {
        case "aggregation":
          return [agg["arg"]];
        case "metric":
          return [
            options.jsx ? (
              <MetricClause>{agg["arg"]}</MetricClause>
            ) : (
              agg["arg"]
            ),
          ];
        case "rows":
          return [t`Raw data`];
        case "count":
          return [t`Count`];
        case "cum-count":
          return [t`Cumulative count`];
        case "avg":
          return [t`Average of `, agg["arg"]];
        case "distinct":
          return [t`Distinct values of `, agg["arg"]];
        case "stddev":
          return [t`Standard deviation of `, agg["arg"]];
        case "sum":
          return [t`Sum of `, agg["arg"]];
        case "cum-sum":
          return [t`Cumulative sum of `, agg["arg"]];
        case "max":
          return [t`Maximum of `, agg["arg"]];
        case "min":
          return [t`Minimum of `, agg["arg"]];
      }
    }),
  );
}

export function formatBreakoutDescription({ breakout }, options = {}) {
  if (!breakout || !breakout.length) {
    return [];
  }

  return [
    t`Grouped by `,
    joinList(
      breakout.map(b => b),
      " and ",
    ),
  ];
}

export function formatFilterDescription({ filter }, options = {}) {
  if (!filter || !filter.length) {
    return [];
  }

  return [
    t`Filtered by `,
    joinList(
      filter.map(f => {
        if (f["segment"] != null) {
          return options.jsx ? (
            <FilterClause>{f["segment"]}</FilterClause>
          ) : (
            f["segment"]
          );
        } else if (f["field"] != null) {
          return f["field"];
        }
      }),
      ", ",
    ),
  ];
}

export function formatOrderByDescription(parts, options = {}) {
  const orderBy = parts["order-by"];
  if (!orderBy || !orderBy.length) {
    return [];
  }

  return [
    t`Sorted by `,
    joinList(
      orderBy.map(
        field =>
          field["field"] +
          " " +
          (field["direction"] === "asc" ? "ascending" : "descending"),
      ),
      " and ",
    ),
  ];
}

export function formatLimitDescription({ limit }, options = {}) {
  if (limit == null) {
    return [];
  }

  return [limit, " ", inflection.inflect("row", limit)];
}

export function formatQueryDescription(parts, options = {}) {
  if (!parts) {
    return "";
  }

  options = {
    jsx: false,
    sections: [
      "table",
      "aggregation",
      "breakout",
      "filter",
      "order-by",
      "limit",
    ],
    ...options,
  };

  const sectionFns = {
    table: formatTableDescription,
    aggregation: formatAggregationDescription,
    breakout: formatBreakoutDescription,
    filter: formatFilterDescription,
    "order-by": formatOrderByDescription,
    limit: formatLimitDescription,
  };

  // these array gymnastics are needed to support JSX formatting
  const sections = (options.sections || [])
    .map(section =>
      _.flatten(sectionFns[section](parts, options)).filter(s => !!s),
    )
    .filter(s => s && s.length > 0);

  const description = _.flatten(joinList(sections, ", "));
  if (options.jsx) {
    return <span>{description}</span>;
  } else {
    return description.join("");
  }
}

export function getDatetimeFieldUnit(field) {
  if (field && FIELD_REF.isLocalField(field)) {
    const options = field[2];
    if (options) {
      return options["temporal-unit"];
    }
  }
  return null;
}

export function getAggregationType(aggregation) {
  return aggregation && aggregation[0];
}

export function getAggregationField(aggregation) {
  return aggregation && aggregation[1];
}

export function getQueryColumn(tableMetadata, field) {
  const target = FIELD_REF.getFieldTarget(field, tableMetadata);
  const column = { ...target.field };
  if (FIELD_REF.isLocalField(field) && getDatetimeFieldUnit(field)) {
    column.unit = getDatetimeFieldUnit(field);
  }
  return column;
}

function joinList(list, joiner) {
  return _.flatten(
    list.map((l, i) => (i === list.length - 1 ? [l] : [l, joiner])),
    true,
  );
}

function conjunctList(list, conjunction) {
  switch (list.length) {
    case 0:
      return null;
    case 1:
      return list[0];
    case 2:
      return [list[0], " ", conjunction, " ", list[1]];
    default:
      return [
        list.slice(0, -1).join(", "),
        ", ",
        conjunction,
        " ",
        list[list.length - 1],
      ];
  }
}
