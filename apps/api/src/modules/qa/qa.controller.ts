import { Body, Controller, Inject, Post } from "@nestjs/common";
import { IsArray, IsOptional, IsString } from "class-validator";

import { QaService } from "./qa.service";

class AskQuestionDto {
  @IsString()
  questionText!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  companyNames?: string[];
}

@Controller("qa")
export class QaController {
  constructor(@Inject(QaService) private readonly qaService: QaService) { }

  @Post("ask")
  ask(@Body() body: AskQuestionDto) {
    return this.qaService.answer(body.questionText, body.companyNames ?? []);
  }
}