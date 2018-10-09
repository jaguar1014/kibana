/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import _ from 'lodash';
import React, {Fragment} from 'react';
import PropTypes from 'prop-types';

import {
  EuiFormRow,
  EuiButton,
} from '@elastic/eui';
import {IndexPatternSelect} from 'ui/index_patterns/components/index_pattern_select';


import { ASource } from './source';
import { Schemas } from 'ui/vis/editors/default/schemas';
import {
  indexPatternService,
  inspectorAdapters,
  SearchSource,
  timeService,
} from '../../../kibana_services';
import { createExtentFilter } from '../../../elasticsearch_geo_utils';
import { AggConfigs } from 'ui/vis/agg_configs';
import { tabifyAggResponse } from 'ui/agg_response/tabify';
import { getRequestInspectorStats, getResponseInspectorStats } from 'ui/courier/utils/courier_inspector_utils';

const aggSchemas = new Schemas([
  {
    group: 'metrics',
    name: 'metric',
    title: 'Value',
    min: 1,
    max: 1,  // TODO add support for multiple metric aggregations - convertToGeoJson will need to be tweeked
    aggFilter: ['count', 'avg', 'sum', 'min', 'max', 'cardinality', 'top_hits'],
    defaults: [
      { schema: 'metric', type: 'count' }
    ]
  },
  {
    group: 'buckets',
    name: 'segment',
    title: 'Terms',
    aggFilter: 'terms',
    min: 1,
    max: 1
  }
]);

export class ESTableSource extends ASource {

  static type = 'ES_TABLE_SOURCE';


  static renderEditor({}) {
    return `<div>editor details</div>`;
  }

  renderDetails() {
    return (<Fragment>table source details</Fragment>);
  }

  async getTable() {

    // inspectorAdapters.requests.resetRequest(layerId);

    if (!this._descriptor.indexPatternId && !this._descriptor.term) {
      console.warn('Table source incorrectly configured');
      return [];
    }

    let indexPattern;
    try {
      indexPattern = await indexPatternService.get(this._descriptor.indexPatternId);
    } catch (error) {
      throw new Error(`Unable to find Index pattern ${this._descriptor.indexPatternId}`);
    }

    const aggConfigs = new AggConfigs(indexPattern, this._makeAggConfigs(), aggSchemas.all);
    //
    // let inspectorRequest;
    let resp;
    try {
      const searchSource = new SearchSource();
      searchSource.setField('index', indexPattern);
      searchSource.setField('size', 0);

      const dsl = aggConfigs.toDsl();
      searchSource.setField('aggs', dsl);
      resp = await searchSource.fetch();
    } catch (error) {
      throw new Error(`Elasticsearch search request failed, error: ${error.message}`);
    }

    const tabifiedResp = tabifyAggResponse(aggConfigs, resp);
    const colName1 = tabifiedResp.columns[0].id;
    const colName2 = tabifiedResp.columns[1].id;
    const table = tabifiedResp.rows.map((row) => {
      return {
        key: row[colName1],
        value: row[colName2]
      };
    });

    return table;

  }



  async isTimeAware() {
    //todo
    return false;
  }

  isFilterByMapBounds() {
    //todo
    return false;
  }

  _makeAggConfigs() {

    return [
      {
        id: '1',
        enabled: true,
        type: 'count',
        schema: 'metric',
        params: {}
      },
      {
        id: '2',
        enabled: true,
        type: 'terms',
        schema: 'segment',
        params: {
          "field": this._descriptor.term,
          "size": 10000
        }
      }
    ];
  }


  getDisplayName() {
    return `es_table ${this._descriptor.indexPatternId}`;
  }
}


