import * as systeminformation from 'systeminformation';
import * as _ from 'lodash';
import { promises as fs } from 'fs';

import { exec } from './fs-utils';

export async function getCpuUsage(): Promise<number> {
	const cpuData = await systeminformation.currentLoad();
	const totalLoad = cpuData.cpus.reduce((load, cpuLoad) => {
		return load + cpuLoad.load;
	}, 0);
	return Math.round(totalLoad / cpuData.cpus.length);
}

export async function getStorageInfo(): Promise<{
	blockDevice: string;
	storageUsed?: number;
	storageTotal?: number;
}> {
	const fsInfo = await systeminformation.fsSize();
	let mainFs: string | undefined;
	let total = 0;
	// First we find the block device which the data partition is part of
	for (const partition of fsInfo) {
		if (partition.mount === '/data') {
			mainFs = partition.fs;
			total = partition.size;
			break;
		}
	}

	if (!mainFs) {
		return {
			blockDevice: '',
			storageUsed: undefined,
			storageTotal: undefined,
		};
	}

	let used = 0;
	for (const partition of fsInfo) {
		if (partition.fs.startsWith(mainFs)) {
			used += partition.used;
		}
	}

	return {
		blockDevice: mainFs,
		storageUsed: bytesToMb(used),
		storageTotal: bytesToMb(total),
	};
}

export async function getMemoryInformation(): Promise<{
	used: number;
	total: number;
}> {
	const mem = await systeminformation.mem();
	return {
		used: bytesToMb(mem.used - mem.cached - mem.buffers),
		total: bytesToMb(mem.total),
	};
}

export async function getCpuTemp(): Promise<number> {
	const tempInfo = await systeminformation.cpuTemperature();
	return Math.round(tempInfo.main);
}

export async function getCpuId(): Promise<string | undefined> {
	try {
		const buffer = await fs.readFile('/proc/device-tree/serial-number');
		// Remove the null byte at the end
		return buffer.toString('utf-8').replace(/\0/g, '');
	} catch {
		return undefined;
	}
}

const undervoltageRegex = /under.*voltage/;
export async function undervoltageDetected(): Promise<boolean> {
	try {
		const { stdout: dmesgStdout } = await exec('dmesg');
		return undervoltageRegex.test(dmesgStdout.toString());
	} catch {
		return false;
	}
}

export async function getSysInfoToReport() {
	const [cpu, mem, temp, cpuid, storage, undervoltage] = await Promise.all([
		getCpuUsage(),
		getMemoryInformation(),
		getCpuTemp(),
		getCpuId(),
		getStorageInfo(),
		undervoltageDetected(),
	]);

	return {
		cpu_usage: cpu,
		memory_usage: mem.used,
		memory_total: mem.total,
		storage_usage: storage.storageUsed,
		storage_total: storage.storageTotal,
		storage_block_device: storage.blockDevice,
		cpu_temp: temp,
		cpu_id: cpuid,
		is_undervolted: undervoltage,
	};
}

export type SystemInfo = UnwrappedPromise<
	ReturnType<typeof getSysInfoToReport>
>;

const significantChange: { [key in keyof SystemInfo]?: number } = {
	cpu_usage: 20,
	cpu_temp: 5,
	memory_usage: 10,
};

export function filterNonSignificantChanges(
	past: Partial<SystemInfo>,
	current: SystemInfo,
): Array<keyof SystemInfo> {
	return Object.keys(
		_.omitBy(current, (value, key: keyof SystemInfo) => {
			// If we didn't have a value for this in the past, include it
			if (past[key] == null) {
				return true;
			}
			const bucketSize = significantChange[key];
			// If we don't have any requirements on this value, include it
			if (bucketSize == null) {
				return true;
			}

			return (
				Math.floor((value as number) / bucketSize) !==
				Math.floor((past[key] as number) / bucketSize)
			);
		}),
	) as Array<keyof SystemInfo>;
}

function bytesToMb(bytes: number) {
	return Math.floor(bytes / 1024 / 1024);
}
