import type { Group, RegisterDef } from '../types.js';
import { GEN_REGISTERS, TRG_REGISTERS } from './gen.js';
import { BF_REGISTERS, PMT_REGISTERS } from './pmtbf.js';
import { SIPM_DAQ_REGISTERS, SIPM_FE_REGISTERS } from './sipm.js';
import { COMMANDS } from './cmds.js';

export const ALL_REGISTERS: RegisterDef[] = [
  ...GEN_REGISTERS,
  ...TRG_REGISTERS,
  ...PMT_REGISTERS,
  ...BF_REGISTERS,
  ...SIPM_DAQ_REGISTERS,
  ...SIPM_FE_REGISTERS,
  ...COMMANDS,
];

const byId = new Map(ALL_REGISTERS.map((r) => [r.id, r]));

export function getRegister(id: string): RegisterDef {
  const r = byId.get(id);
  if (!r) throw new Error(`Unknown register "${id}"`);
  return r;
}

export const registersByGroup = (g: Group): RegisterDef[] =>
  ALL_REGISTERS.filter((r) => r.group === g);

export const GROUP_LABELS: Record<Group, string> = {
  GEN: 'General',
  TRG: 'Trigger',
  PMT: 'PMT plane',
  BF: 'Energy plane (BF)',
  SIPM_DAQ: 'SiPM DAQ',
  SIPM_FE: 'SiPM front-end',
  CMD: 'Commands',
};

export * from './gen.js';
export * from './pmtbf.js';
export * from './sipm.js';
export * from './cmds.js';
