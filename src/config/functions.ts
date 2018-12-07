import * as Bluebird from 'bluebird';
import { Transaction } from 'knex';
import * as _ from 'lodash';
import { URL } from 'url';

import Config = require('../config');
import supervisorVersion = require('../lib/supervisor-version');

import * as constants from '../lib/constants';
import * as osRelease from '../lib/os-release';
import { ConfigValue } from '../lib/types';
import { checkTruthy } from '../lib/validation';

// A provider for schema entries with source 'func'
type ConfigProviderFunctionGetter = () => Bluebird<any>;
type ConfigProviderFunctionSetter = (
	value: ConfigValue,
	tx?: Transaction,
) => Bluebird<void>;
type ConfigProviderFunctionRemover = () => Bluebird<void>;

interface ConfigProviderFunction {
	get: ConfigProviderFunctionGetter;
	set?: ConfigProviderFunctionSetter;
	remove?: ConfigProviderFunctionRemover;
}

export interface ConfigProviderFunctions {
	[key: string]: ConfigProviderFunction;
}

export function createProviderFunctions(
	config: Config,
): ConfigProviderFunctions {
	return {
		version: {
			get: () => {
				return Bluebird.resolve(supervisorVersion);
			},
		},
		currentApiKey: {
			get: () => {
				return config
					.getMany(['apiKey', 'deviceApiKey'])
					.then(({ apiKey, deviceApiKey }) => {
						return apiKey || deviceApiKey;
					});
			},
		},
		offlineMode: {
			get: () => {
				return config
					.getMany(['apiEndpoint', 'supervisorOfflineMode'])
					.then(({ apiEndpoint, supervisorOfflineMode }) => {
						return (
							checkTruthy(supervisorOfflineMode as boolean) || !apiEndpoint
						);
					});
			},
		},
		provisioned: {
			get: () => {
				return config
					.getMany(['uuid', 'apiEndpoint', 'registered_at', 'deviceId'])
					.then(requiredValues => {
						return _.every(_.values(requiredValues), Boolean);
					});
			},
		},
		osVersion: {
			get: () => {
				return osRelease.getOSVersion(constants.hostOSVersionPath);
			},
		},
		osVariant: {
			get: () => {
				return osRelease.getOSVariant(constants.hostOSVersionPath);
			},
		},
		provisioningOptions: {
			get: () => {
				return config
					.getMany([
						'uuid',
						'userId',
						'applicationId',
						'apiKey',
						'deviceApiKey',
						'deviceType',
						'apiEndpoint',
						'apiTimeout',
						'registered_at',
						'deviceId',
					])
					.then(conf => {
						return {
							uuid: conf.uuid,
							applicationId: conf.applicationId,
							userId: conf.userId,
							deviceType: conf.deviceType,
							provisioningApiKey: conf.apiKey,
							deviceApiKey: conf.deviceApiKey,
							apiEndpoint: conf.apiEndpoint,
							apiTimeout: conf.apiTimeout,
							registered_at: conf.registered_at,
							deviceId: conf.deviceId,
						};
					});
			},
		},
		mixpanelHost: {
			get: () => {
				return config.get('apiEndpoint').then(apiEndpoint => {
					if (!apiEndpoint) {
						return null;
					}
					const url = new URL(apiEndpoint as string);
					return { host: url.host, path: '/mixpanel' };
				});
			},
		},
		extendedEnvOptions: {
			get: () => {
				return config.getMany([
					'uuid',
					'listenPort',
					'name',
					'apiSecret',
					'deviceApiKey',
					'version',
					'deviceType',
					'osVersion',
				]);
			},
		},
		fetchOptions: {
			get: () => {
				return config.getMany([
					'uuid',
					'currentApiKey',
					'apiEndpoint',
					'deltaEndpoint',
					'delta',
					'deltaRequestTimeout',
					'deltaApplyTimeout',
					'deltaRetryCount',
					'deltaRetryInterval',
					'deltaVersion',
				]);
			},
		},
		unmanaged: {
			get: () => {
				return config.get('apiEndpoint').then(apiEndpoint => {
					if (!apiEndpoint) {
						return true;
					} else {
						return false;
					}
				});
			},
		},

		localMode: {
			get: () => {
				// if local mode has been set explicitly, or
				// we are in unmanaged mode, enable local mode
				return config
					.getMany(['explicitLocalMode', 'unmanaged'])
					.then(({ explicitLocalMode, unmanaged }) => {
						return explicitLocalMode || unmanaged;
					});
			},
			set: value => {
				return config.set({
					explicitLocalMode: checkTruthy(value || false) || false,
				});
			},
		},
	};
}
