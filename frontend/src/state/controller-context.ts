import { createContext, useContext } from 'react';
import type { Controller } from './controller';

export const ControllerContext = createContext<Controller | null>(null);
export const useControllerRef = (): Controller | null => useContext(ControllerContext);
