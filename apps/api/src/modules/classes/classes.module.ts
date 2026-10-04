import { Module } from '@nestjs/common';
import { AdminClassesController } from './admin-classes.controller';
import {
  DashboardController,
  HallsController,
  SettingsController,
  TimetableController,
} from './admin-misc.controllers';
import { ClassesService } from './classes.service';
import { DashboardService } from './dashboard.service';
import { HallsService } from './halls.service';
import { MeController } from './me.controller';
import { MyClassesService } from './my-classes.service';
import { SettingsService } from './settings.service';
import { TimetableService } from './timetable.service';

/**
 * Classes: the student's own list (`GET /me/classes`) and the admin side — classes, halls,
 * enrolments and fee overrides, the weekly timetable (staff and public), the dashboard and
 * institute settings (CLS-01…06, TEN-03).
 */
@Module({
  controllers: [
    MeController,
    AdminClassesController,
    HallsController,
    TimetableController,
    DashboardController,
    SettingsController,
  ],
  providers: [
    MyClassesService,
    ClassesService,
    HallsService,
    TimetableService,
    DashboardService,
    SettingsService,
  ],
})
export class ClassesModule {}
