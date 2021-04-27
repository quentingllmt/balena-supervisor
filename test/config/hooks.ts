import { mockDbus } from '../lib/mocked-dbus';
import { overrideEvents } from '../lib/mocked-dockerode';
import { overrideIptablesRuleAdapter } from '../lib/mocked-iptables';

/**
 * Root level global hook to set up test files
 * and env vars that multiple test suites, but not all
 * test suites, might use.
 *
 * All Mocha hooks are accepted, and will execute before any
 * root-level hooks declared in any spec files.
 */
export const mochaHooks = function () {
	return {
		beforeAll() {
			mockDbus();
			overrideEvents();
			overrideIptablesRuleAdapter();
		},
	};
};
