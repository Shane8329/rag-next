import { Body, Controller, Inject, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

import { LegacyImportService } from "./legacy-import.service";

class LegacyChunkDto {
  @IsOptional()
  @IsArray()
  lines?: [number, number];

  @IsString()
  text!: string;
}

class LegacyChunkDocumentDto {
  @ValidateNested()
  @Type(() => Object)
  metainfo!: {
    sha1: string;
    company_name: string;
    file_name: string;
  };

  @ValidateNested()
  @Type(() => Object)
  content!: {
    chunks: LegacyChunkDto[];
  };
}

@Controller("ingestion")
export class LegacyImportController {
  constructor(@Inject(LegacyImportService) private readonly legacyImportService: LegacyImportService) {}

  @Post("legacy-chunk")
  importLegacyChunk(@Body() body: LegacyChunkDocumentDto) {
    return this.legacyImportService.importLegacyChunkDocument(body);
  }

  @Post("legacy-chunk/batch")
  importLegacyChunkBatch(@Body() body: LegacyChunkDocumentDto[]) {
    return this.legacyImportService.importLegacyChunkDocuments(body);
  }
}