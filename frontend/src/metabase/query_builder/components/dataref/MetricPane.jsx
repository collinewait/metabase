/* eslint "react/prop-types": "warn" */
import React, { Component } from "react";
import { connect } from "react-redux";
import PropTypes from "prop-types";
import { t } from "ttag";

import _ from "underscore";
import { createCard } from "metabase/lib/card";

import QueryButton from "metabase/components/QueryButton";
import { fetchTableMetadata } from "metabase/redux/metadata";

import { getMetadata } from "metabase/selectors/metadata";
import * as Q_DEPRECATED from "metabase-lib/lib/queries/utils";
import QueryDefinition from "../QueryDefinition";
import DetailPane from "./DetailPane";

const mapDispatchToProps = {
  fetchTableMetadata,
};

const mapStateToProps = (state, props) => ({
  metadata: getMetadata(state, props),
});

class MetricPane extends Component {
  constructor(props, context) {
    super(props, context);

    _.bindAll(this, "setQueryMetric");
  }

  static propTypes = {
    metric: PropTypes.object.isRequired,
    query: PropTypes.object,
    fetchTableMetadata: PropTypes.func.isRequired,
    runQuestionQuery: PropTypes.func.isRequired,
    setDatasetQuery: PropTypes.func.isRequired,
    setCardAndRun: PropTypes.func.isRequired,
    metadata: PropTypes.object,
  };

  UNSAFE_componentWillMount() {
    this.props.fetchTableMetadata(this.props.metric.table_id);
  }

  newCard() {
    const { metric, metadata } = this.props;
    const table = metadata && metadata.table(metric.table_id);

    if (table) {
      const card = createCard();
      card.dataset_query = Q_DEPRECATED.createQuery(
        "query",
        table.db_id,
        table.id,
      );
      return card;
    } else {
      throw new Error(
        t`Could not find the table metadata prior to creating a new question`,
      );
    }
  }

  setQueryMetric() {
    const card = this.newCard();
    card.dataset_query.query.aggregation = ["metric", this.props.metric.id];
    this.props.setCardAndRun(card);
  }

  render() {
    const { metric } = this.props;

    const metricName = metric.name;

    const useForCurrentQuestion = [];
    const usefulQuestions = [];

    usefulQuestions.push(
      <QueryButton
        icon="number"
        text={t`See ${metricName}`}
        onClick={this.setQueryMetric}
      />,
    );

    return (
      <DetailPane
        description={metric.description}
        useForCurrentQuestion={useForCurrentQuestion}
        usefulQuestions={usefulQuestions}
        extra={
          <div>
            <p className="text-bold">{t`Metric Definition`}</p>
            <QueryDefinition object={metric} />
          </div>
        }
      />
    );
  }
}

export default connect(mapStateToProps, mapDispatchToProps)(MetricPane);
