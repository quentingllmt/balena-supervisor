import * as dbus from 'dbus';
import { DBusError, DBusInterface } from 'dbus';
import { stub } from 'sinon';

export const mockDbus = function () {
	console.log('🚌 Mocking dbus...');
	stub(dbus, 'getBus').returns({
		getInterface: (
			_serviceName: string,
			_objectPath: string,
			_interfaceName: string,
			interfaceCb: (err: null | DBusError, iface: DBusInterface) => void,
		) => {
			interfaceCb(null, {
				Get: (
					_unitName: string,
					_property: string,
					getCb: (err: null | Error, value: unknown) => void,
				) => {
					getCb(null, 'this is the value');
				},
				GetUnit: (
					_unitName: string,
					getUnitCb: (err: null | Error, unitPath: string) => void,
				) => {
					getUnitCb(null, 'this is the unit path');
				},
				StartUnit: (_unitName: string) => {
					/* noop */
				},
				RestartUnit: (_unitName: string, _mode: string) => {
					/* noop */
				},
			} as any);
		},
	} as any);
};
