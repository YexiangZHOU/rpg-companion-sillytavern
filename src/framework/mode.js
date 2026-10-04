import { getContext } from '../../../../../extensions.js';
import { frameworkMode } from './chat.mjs';
export const isUniversalFramework = () => frameworkMode(getContext()) === 'universal';
