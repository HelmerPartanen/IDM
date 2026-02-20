import { ipcMain } from 'electron';
import log from 'electron-log';
import { Scheduler } from '../download-engine/scheduler';
import { IPC } from '../../shared/types';
import type { ScheduleInfo } from '../../shared/types';

export function registerScheduleHandlers(scheduler: Scheduler): void {
  ipcMain.handle(IPC.SCHEDULE_ADD, async (_event, schedule: Omit<ScheduleInfo, 'id'>) => {
    try {
      const id = scheduler.addSchedule(schedule);
      return { success: true, id };
    } catch (error: any) {
      log.error('[IPC] schedule:add failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.SCHEDULE_REMOVE, async (_event, id: number) => {
    try {
      scheduler.removeSchedule(id);
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] schedule:remove failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.SCHEDULE_LIST, async () => {
    try {
      const schedules = scheduler.getSchedules();
      return { success: true, schedules };
    } catch (error: any) {
      log.error('[IPC] schedule:list failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  log.info('[IPC] Schedule handlers registered');
}
