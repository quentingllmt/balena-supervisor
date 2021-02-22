import { expect } from 'chai';
import {
	stub,
	SinonStub,
	spy,
	SinonSpy,
	useFakeTimers,
	SinonFakeTimers,
} from 'sinon';
import * as supertest from 'supertest';
import * as Bluebird from 'bluebird';

import sampleResponses = require('./data/device-api-responses.json');
import mockedAPI = require('./lib/mocked-device-api');
import * as apiBinder from '../src/api-binder';
import * as deviceState from '../src/device-state';
import SupervisorAPI from '../src/supervisor-api';
import * as serviceManager from '../src/compose/service-manager';
import * as images from '../src/compose/images';
import * as apiKeys from '../src/lib/api-keys';
import * as config from '../src/config';
import * as updateLock from '../src/lib/update-lock';
import * as targetStateCache from '../src/device-state/target-state-cache';
import * as mockedDockerode from './lib/mocked-dockerode';
import * as applicationManager from '../src/compose/application-manager';
import * as logger from '../src/logger';
import blink = require('../src/lib/blink');
import * as dbus from '../src/lib/dbus';

import { UpdatesLockedError } from '../src/lib/errors';

describe('SupervisorAPI [V2 Endpoints]', () => {
	let serviceManagerMock: SinonStub;
	let imagesMock: SinonStub;
	let applicationManagerSpy: SinonSpy;
	let api: SupervisorAPI;
	const request = supertest(
		`http://127.0.0.1:${mockedAPI.mockedOptions.listenPort}`,
	);

	let loggerStub: SinonStub;
	let healthCheckStubs: SinonStub[];

	before(async () => {
		await apiBinder.initialized;
		await deviceState.initialized;

		// The mockedAPI contains stubs that might create unexpected results
		// See the module to know what has been stubbed
		api = await mockedAPI.create();

		// Start test API
		await api.listen(
			mockedAPI.mockedOptions.listenPort,
			mockedAPI.mockedOptions.timeout,
		);

		// Create a scoped key
		await apiKeys.initialized;
		await apiKeys.generateCloudKey();
		serviceManagerMock = stub(serviceManager, 'getAll').resolves([]);
		imagesMock = stub(images, 'getStatus').resolves([]);

		// We want to check the actual step that was triggered
		applicationManagerSpy = spy(applicationManager, 'executeStep');

		// Stub logs for all API methods
		loggerStub = stub(logger, 'attach');
		loggerStub.resolves();

		// Stub healthchecks for /healthy endpoint
		healthCheckStubs = [
			stub(apiBinder, 'healthcheck'),
			stub(deviceState, 'healthcheck'),
		];
	});

	after(async () => {
		try {
			await api.stop();
		} catch (e) {
			if (e.message !== 'Server is not running.') {
				throw e;
			}
		}
		// Remove any test data generated
		await mockedAPI.cleanUp();
		serviceManagerMock.restore();
		imagesMock.restore();
		applicationManagerSpy.restore();
		loggerStub.restore();
		healthCheckStubs.forEach((hc) => hc.restore());
	});

	afterEach(() => {
		mockedDockerode.resetHistory();
		applicationManagerSpy.resetHistory();
	});

	describe('GET /v2/device/vpn', () => {
		it('returns information about VPN connection', async () => {
			await request
				.get('/v2/device/vpn')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect('Content-Type', /json/)
				.expect(sampleResponses.V2.GET['/device/vpn'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/device/vpn'].body,
					);
				});
		});
	});

	describe('GET /v2/applications/:appId/state', () => {
		it('returns information about a SPECIFIC application', async () => {
			await request
				.get('/v2/applications/1/state')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.GET['/applications/1/state'].statusCode)
				.expect('Content-Type', /json/)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/applications/1/state'].body,
					);
				});
		});

		it('returns 400 for invalid appId', async () => {
			await request
				.get('/v2/applications/123invalid/state')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/applications/123invalid/state'].statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/applications/123invalid/state'].body,
					);
				});
		});

		it('returns 409 because app does not exist', async () => {
			await request
				.get('/v2/applications/9000/state')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.GET['/applications/9000/state'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/applications/9000/state'].body,
					);
				});
		});

		describe('Scoped API Keys', () => {
			it('returns 409 because app is out of scope of the key', async () => {
				const apiKey = await apiKeys.generateScopedKey(3, 1);
				await request
					.get('/v2/applications/2/state')
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKey}`)
					.expect(409);
			});
		});
	});

	describe('GET /v2/state/status', () => {
		before(() => {
			// Stub isApplyInProgress is no other tests can impact the response data
			stub(deviceState, 'isApplyInProgress').returns(false);
		});

		after(() => {
			(deviceState.isApplyInProgress as SinonStub).restore();
		});

		it('should return scoped application', async () => {
			// Create scoped key for application
			const appScopedKey = await apiKeys.generateScopedKey(1658654, 640681);
			// Setup device conditions
			serviceManagerMock.resolves([mockedAPI.mockService({ appId: 1658654 })]);
			imagesMock.resolves([mockedAPI.mockImage({ appId: 1658654 })]);
			// Make request and evaluate response
			await request
				.get('/v2/state/status')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${appScopedKey}`)
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/state/status?desc=single_application']
						.statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/state/status?desc=single_application']
							.body,
					);
				});
		});

		it('should return no application info due to lack of scope', async () => {
			// Create scoped key for wrong application
			const appScopedKey = await apiKeys.generateScopedKey(1, 1);
			// Setup device conditions
			serviceManagerMock.resolves([mockedAPI.mockService({ appId: 1658654 })]);
			imagesMock.resolves([mockedAPI.mockImage({ appId: 1658654 })]);
			// Make request and evaluate response
			await request
				.get('/v2/state/status')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${appScopedKey}`)
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/state/status?desc=no_applications']
						.statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/state/status?desc=no_applications'].body,
					);
				});
		});

		it('should return success when device has no applications', async () => {
			// Create scoped key for any application
			const appScopedKey = await apiKeys.generateScopedKey(1658654, 1658654);
			// Setup device conditions
			serviceManagerMock.resolves([]);
			imagesMock.resolves([]);
			// Make request and evaluate response
			await request
				.get('/v2/state/status')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${appScopedKey}`)
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/state/status?desc=no_applications']
						.statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/state/status?desc=no_applications'].body,
					);
				});
		});

		it('should only return 1 application when N > 1 applications on device', async () => {
			// Create scoped key for application
			const appScopedKey = await apiKeys.generateScopedKey(1658654, 640681);
			// Setup device conditions
			serviceManagerMock.resolves([
				mockedAPI.mockService({ appId: 1658654 }),
				mockedAPI.mockService({ appId: 222222 }),
			]);
			imagesMock.resolves([
				mockedAPI.mockImage({ appId: 1658654 }),
				mockedAPI.mockImage({ appId: 222222 }),
			]);
			// Make request and evaluate response
			await request
				.get('/v2/state/status')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${appScopedKey}`)
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/state/status?desc=single_application']
						.statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/state/status?desc=single_application']
							.body,
					);
				});
		});

		it('should only return 1 application when in LOCAL MODE (no auth)', async () => {
			// Activate localmode
			await config.set({ localMode: true });
			// Setup device conditions
			serviceManagerMock.resolves([
				mockedAPI.mockService({ appId: 1658654 }),
				mockedAPI.mockService({ appId: 222222 }),
			]);
			imagesMock.resolves([
				mockedAPI.mockImage({ appId: 1658654 }),
				mockedAPI.mockImage({ appId: 222222 }),
			]);
			// Make request and evaluate response
			await request
				.get('/v2/state/status')
				.set('Accept', 'application/json')
				.expect('Content-Type', /json/)
				.expect(
					sampleResponses.V2.GET['/state/status?desc=single_application']
						.statusCode,
				)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/state/status?desc=single_application']
							.body,
					);
				});
			// Deactivate localmode
			await config.set({ localMode: false });
		});
	});

	describe('POST /v2/applications/:appId/start-service', function () {
		let appScopedKey: string;
		let targetStateCacheMock: SinonStub;
		let lockMock: SinonStub;

		const service = {
			serviceName: 'main',
			containerId: 'abc123',
			appId: 1658654,
			serviceId: 640681,
		};

		const mockContainers = [mockedAPI.mockService(service)];
		const mockImages = [mockedAPI.mockImage(service)];

		beforeEach(() => {
			// Setup device conditions
			serviceManagerMock.resolves(mockContainers);
			imagesMock.resolves(mockImages);

			targetStateCacheMock.resolves({
				appId: 2,
				commit: 'abcdef2',
				name: 'test-app2',
				source: 'https://api.balena-cloud.com',
				releaseId: 1232,
				services: JSON.stringify([service]),
				networks: '{}',
				volumes: '{}',
			});

			lockMock.reset();
		});

		before(async () => {
			// Create scoped key for application
			appScopedKey = await apiKeys.generateScopedKey(1658654, 640681);

			// Mock target state cache
			targetStateCacheMock = stub(targetStateCache, 'getTargetApp');

			lockMock = stub(updateLock, 'lock');
		});

		after(async () => {
			targetStateCacheMock.restore();
			lockMock.restore();
		});

		it('should return 200 for an existing service', async () => {
			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/start-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main' })
						.set('Content-type', 'application/json')
						.expect(200);

					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});

		it('should return 404 for an unknown service', async () => {
			await request
				.post(`/v2/applications/1658654/start-service?apikey=${appScopedKey}`)
				.send({ serviceName: 'unknown' })
				.set('Content-type', 'application/json')
				.expect(404);

			expect(applicationManagerSpy).to.not.have.been.called;
		});

		it('should ignore locks and return 200', async () => {
			// Turn lock on
			lockMock.throws(new UpdatesLockedError('Updates locked'));

			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/start-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main' })
						.set('Content-type', 'application/json')
						.expect(200);

					expect(lockMock).to.not.have.been.called;
					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});
	});

	describe('POST /v2/applications/:appId/restart-service', () => {
		let appScopedKey: string;
		let targetStateCacheMock: SinonStub;
		let lockMock: SinonStub;

		const service = {
			serviceName: 'main',
			containerId: 'abc123',
			appId: 1658654,
			serviceId: 640681,
		};

		const mockContainers = [mockedAPI.mockService(service)];
		const mockImages = [mockedAPI.mockImage(service)];
		const lockFake = (_: any, opts: { force: boolean }, fn: () => any) => {
			if (opts.force) {
				return Bluebird.resolve(fn());
			}

			throw new UpdatesLockedError('Updates locked');
		};

		beforeEach(() => {
			// Setup device conditions
			serviceManagerMock.resolves(mockContainers);
			imagesMock.resolves(mockImages);

			targetStateCacheMock.resolves({
				appId: 2,
				commit: 'abcdef2',
				name: 'test-app2',
				source: 'https://api.balena-cloud.com',
				releaseId: 1232,
				services: JSON.stringify(mockContainers),
				networks: '{}',
				volumes: '{}',
			});

			lockMock.reset();
		});

		before(async () => {
			// Create scoped key for application
			appScopedKey = await apiKeys.generateScopedKey(1658654, 640681);

			// Mock target state cache
			targetStateCacheMock = stub(targetStateCache, 'getTargetApp');
			lockMock = stub(updateLock, 'lock');
		});

		after(async () => {
			targetStateCacheMock.restore();
			lockMock.restore();
		});

		it('should return 200 for an existing service', async () => {
			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/restart-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main' })
						.set('Content-type', 'application/json')
						.expect(200);

					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});

		it('should return 404 for an unknown service', async () => {
			await request
				.post(`/v2/applications/1658654/restart-service?apikey=${appScopedKey}`)
				.send({ serviceName: 'unknown' })
				.set('Content-type', 'application/json')
				.expect(404);
			expect(applicationManagerSpy).to.not.have.been.called;
		});

		it('should return 423 for a service with update locks', async () => {
			// Turn lock on
			lockMock.throws(new UpdatesLockedError('Updates locked'));

			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/restart-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main' })
						.set('Content-type', 'application/json')
						.expect(423);

					expect(lockMock).to.be.calledOnce;
					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});

		it('should return 200 for a service with update locks and force true', async () => {
			// Turn lock on
			lockMock.callsFake(lockFake);

			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/restart-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main', force: true })
						.set('Content-type', 'application/json')
						.expect(200);

					expect(lockMock).to.be.calledOnce;
					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});

		it('should return 423 if force is explicitely set to false', async () => {
			// Turn lock on
			lockMock.callsFake(lockFake);

			await mockedDockerode.testWithData(
				{ containers: mockContainers, images: mockImages },
				async () => {
					await request
						.post(
							`/v2/applications/1658654/restart-service?apikey=${appScopedKey}`,
						)
						.send({ serviceName: 'main', force: false })
						.set('Content-type', 'application/json')
						.expect(423);

					expect(lockMock).to.be.calledOnce;
					expect(applicationManagerSpy).to.have.been.calledOnce;
				},
			);
		});
	});

	describe('POST /v2/blink', () => {
		it('responds with code 200 and empty body', async () => {
			await request
				.post('/v2/blink')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/blink'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.POST['/blink'].body,
					);
					expect(response.text).to.deep.equal(
						sampleResponses.V2.POST['/blink'].text,
					);
				});
		});

		it('directs device to blink for 15000ms (hardcoded length)', async () => {
			const blinkStartSpy: SinonSpy = spy(blink.pattern, 'start');
			const blinkStopSpy: SinonSpy = spy(blink.pattern, 'stop');
			const clock: SinonFakeTimers = useFakeTimers();

			await request
				.post('/v2/blink')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.then(() => {
					expect(blinkStartSpy.callCount).to.equal(1);
					clock.tick(15000);
					expect(blinkStopSpy.callCount).to.equal(1);
				});

			blinkStartSpy.restore();
			blinkStopSpy.restore();
			clock.restore();
		});
	});

	describe('POST /v2/regenerate-api-key', () => {
		it('returns a valid new API key', async () => {
			const refreshKeySpy: SinonSpy = spy(apiKeys, 'refreshKey');

			let newKey: string = '';

			await request
				.post('/v2/regenerate-api-key')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/regenerate-api-key'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.POST['/regenerate-api-key'].body,
					);
					expect(response.text).to.equal(apiKeys.cloudApiKey);
					newKey = response.text;
					expect(refreshKeySpy.callCount).to.equal(1);
				});

			// Ensure persistence with future calls
			await request
				.post('/v2/blink')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${newKey}`)
				.expect(sampleResponses.V2.POST['/blink'].statusCode);

			refreshKeySpy.restore();
		});

		it('expires old API key after generating new key', async () => {
			const oldKey: string = apiKeys.cloudApiKey;

			await request
				.post('/v2/regenerate-api-key')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${oldKey}`)
				.expect(sampleResponses.V2.POST['/regenerate-api-key'].statusCode);

			await request
				.post('/v2/blink')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${oldKey}`)
				.expect(401);
		});

		it('communicates the new API key to balena API', async () => {
			const reportStateSpy: SinonSpy = spy(deviceState, 'reportCurrentState');

			await request
				.post('/v2/regenerate-api-key')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.then(() => {
					expect(reportStateSpy.callCount).to.equal(1);
					// Cloud key has changed at this point so we assert that the call to
					// report state was made with the new key
					expect(reportStateSpy.args[0][0]).to.deep.equal({
						api_secret: apiKeys.cloudApiKey,
					});
				});

			reportStateSpy.restore();
		});
	});

	describe('GET /v2/healthy', () => {
		it('returns OK because all checks pass', async () => {
			// Make all healthChecks pass
			healthCheckStubs.forEach((hc) => hc.resolves(true));
			await request
				.get('/v2/healthy')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.GET['/healthy'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/healthy'].body,
					);
					expect(response.text).to.deep.equal(
						sampleResponses.V2.GET['/healthy'].text,
					);
				});
		});

		it('Fails because some checks did not pass', async () => {
			healthCheckStubs.forEach((hc) => hc.resolves(false));
			await request
				.get('/v2/healthy')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.GET['/healthy [2]'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.GET['/healthy [2]'].body,
					);
					expect(response.text).to.deep.equal(
						sampleResponses.V2.GET['/healthy [2]'].text,
					);
				});
		});
	});

	describe('POST /v2/reboot', () => {
		let rebootMock: SinonStub;
		let stopAllSpy: SinonSpy;

		before(() => {
			rebootMock = stub(dbus, 'reboot').resolves((() => void 0) as any);
			stopAllSpy = spy(applicationManager, 'stopAll');

			// Mock a multi-container app
			serviceManagerMock.resolves([
				mockedAPI.mockService({ appId: 12345 }),
				mockedAPI.mockService({ appId: 54321 }),
			]);
			imagesMock.resolves([
				mockedAPI.mockImage({ appId: 12345 }),
				mockedAPI.mockImage({ appId: 54321 }),
			]);
		});

		after(() => {
			rebootMock.restore();
		});

		afterEach(() => {
			rebootMock.resetHistory();
		});

		it('should return 202 and reboot if no locks are set', async () => {
			await request
				.post('/v2/reboot')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/reboot [202]'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.POST['/reboot [202]'].body,
					);
					expect(response.text).to.equal(
						sampleResponses.V2.POST['/reboot [202]'].text,
					);
					expect(rebootMock).to.have.been.calledOnce;
				});
		});

		it('should return 500 for server errors that are not related to update locks', async () => {
			stub(deviceState, 'executeStepAction').throws(() => {
				return new Error('Test error');
			});

			await request
				.post('/v2/reboot')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(500)
				.then((response) => {
					expect(response.text).to.equal('Test error');
				});

			(deviceState.executeStepAction as SinonStub).restore();
		});

		it('should attempt to stop services first before reboot', async () => {
			await request
				.post('/v2/reboot')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/reboot [202]'].statusCode)
				.then(() => {
					expect(stopAllSpy).to.have.been.called;
					expect(rebootMock).to.have.been.calledOnce;
					expect(stopAllSpy).to.have.been.calledBefore(rebootMock);
				});

			stopAllSpy.restore();
		});

		describe('POST /v2/reboot - Updates locked', () => {
			let updateLockStub: SinonStub;

			before(() => {
				updateLockStub = stub(updateLock, 'lock').callsFake((__, opts, fn) => {
					if (opts.force) {
						return Bluebird.resolve(fn());
					}
					throw new UpdatesLockedError('Updates locked');
				});
			});

			after(() => {
				updateLockStub.restore();
			});

			it('should return 423 and reject the reboot if no locks are set', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(false);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/reboot')
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/reboot [423]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/reboot [423]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/reboot [423]'].text,
						);
						expect(updateLock.lock).to.be.called;
						expect(rebootMock).to.not.have.been.called;
					});

				(config.get as SinonStub).restore();
			});

			it('should return 202 and reboot if force is set to true', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(false);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/reboot')
					.send({
						force: true,
					})
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/reboot [202]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/reboot [202]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/reboot [202]'].text,
						);
						expect(updateLock.lock).to.be.called;
						expect(rebootMock).to.have.been.calledOnce;
					});

				(config.get as SinonStub).restore();
			});

			it('should return 202 and reboot if lock override config is set to true', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(true);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/reboot')
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/reboot [202]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/reboot [202]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/reboot [202]'].text,
						);
						expect(updateLock.lock).to.have.been.called;
						expect(rebootMock).to.have.been.calledOnce;
					});

				(config.get as SinonStub).restore();
			});
		});
	});

	describe('POST /v2/shutdown', () => {
		let shutdownMock: SinonStub;
		let stopAllSpy: SinonSpy;

		before(() => {
			shutdownMock = stub(dbus, 'shutdown').resolves((() => void 0) as any);
			stopAllSpy = spy(applicationManager, 'stopAll');

			// Mock a multi-container app
			serviceManagerMock.resolves([
				mockedAPI.mockService({ appId: 12345 }),
				mockedAPI.mockService({ appId: 54321 }),
			]);
			imagesMock.resolves([
				mockedAPI.mockImage({ appId: 12345 }),
				mockedAPI.mockImage({ appId: 54321 }),
			]);
		});

		after(() => {
			shutdownMock.restore();
		});

		afterEach(() => {
			shutdownMock.resetHistory();
		});

		it('should return 202 and shutdown if no locks are set', async () => {
			await request
				.post('/v2/shutdown')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/shutdown [202]'].statusCode)
				.then((response) => {
					expect(response.body).to.deep.equal(
						sampleResponses.V2.POST['/shutdown [202]'].body,
					);
					expect(response.text).to.equal(
						sampleResponses.V2.POST['/shutdown [202]'].text,
					);
					expect(shutdownMock).to.have.been.calledOnce;
				});
		});

		it('should return 500 for errors that are not related to update locks', async () => {
			stub(deviceState, 'executeStepAction').throws(() => {
				return new Error('Test error');
			});

			await request
				.post('/v2/shutdown')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(500)
				.then((response) => {
					expect(response.text).to.equal('Test error');
				});

			(deviceState.executeStepAction as SinonStub).restore();
		});

		it('should attempt to stop services first before shutdown', async () => {
			await request
				.post('/v2/shutdown')
				.set('Accept', 'application/json')
				.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
				.expect(sampleResponses.V2.POST['/shutdown [202]'].statusCode)
				.then(() => {
					expect(stopAllSpy).to.have.been.called;
					expect(shutdownMock).to.have.been.calledOnce;
					expect(stopAllSpy).to.have.been.calledBefore(shutdownMock);
				});

			stopAllSpy.restore();
		});

		describe('POST /v2/shutdown -- Updates locked', () => {
			let updateLockStub: SinonStub;

			before(() => {
				updateLockStub = stub(updateLock, 'lock').callsFake((__, opts, fn) => {
					if (opts.force) {
						return Bluebird.resolve(fn());
					}
					throw new UpdatesLockedError('Updates locked');
				});
			});

			after(() => {
				updateLockStub.restore();
			});

			it('should return 423 and reject the shutdown if no locks are set', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(false);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/shutdown')
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/shutdown [423]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/shutdown [423]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/shutdown [423]'].text,
						);
						expect(updateLock.lock).to.have.been.called;
						expect(shutdownMock).to.not.have.been.called;
					});

				(config.get as SinonStub).restore();
			});

			it('should return 202 and shutdown if force is set to true', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(false);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/shutdown')
					.send({ force: true })
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/shutdown [202]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/shutdown [202]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/shutdown [202]'].text,
						);
						expect(updateLock.lock).to.have.been.called;
						expect(shutdownMock).to.have.been.calledOnce;
					});

				(config.get as SinonStub).restore();
			});

			it('should return 202 and shutdown if lock override config is set to true', async () => {
				stub(config, 'get').withArgs('lockOverride').resolves(true);
				// If calling config.get with other args, pass through to non-stubbed method
				(config.get as SinonStub).callThrough();

				await request
					.post('/v2/shutdown')
					.set('Accept', 'application/json')
					.set('Authorization', `Bearer ${apiKeys.cloudApiKey}`)
					.expect(sampleResponses.V2.POST['/shutdown [202]'].statusCode)
					.then((response) => {
						expect(response.body).to.deep.equal(
							sampleResponses.V2.POST['/shutdown [202]'].body,
						);
						expect(response.text).to.equal(
							sampleResponses.V2.POST['/shutdown [202]'].text,
						);
						expect(updateLock.lock).to.have.been.called;
						expect(shutdownMock).to.have.been.calledOnce;
					});

				(config.get as SinonStub).restore();
			});
		});
	});

	// TODO: add tests for rest of V2 endpoints
});
