import { Controller, Get, Inject } from "@nestjs/common";

import { JobsService } from "./jobs.service";

@Controller("jobs")
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get()
  listJobs() {
    return this.jobsService.listJobs();
  }
}