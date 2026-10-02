import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MyClassesService } from './my-classes.service';

/** Student-facing class reads (`GET /me/classes`). Admin class management comes later. */
@Module({ controllers: [MeController], providers: [MyClassesService] })
export class ClassesModule {}
