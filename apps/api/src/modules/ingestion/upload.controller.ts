import { Body, Controller, Inject, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { DocumentUploadService } from "./document-upload.service";

@Controller("documents")
export class UploadController {
  constructor(@Inject(DocumentUploadService) private readonly documentUploadService: DocumentUploadService) {}

  @Post("upload")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body() body: { companyName: string; originalFileName?: string }
  ) {
    return this.documentUploadService.importUploadedDocument({
      buffer: file.buffer,
      companyName: body.companyName,
      originalFileName: body.originalFileName ?? file.originalname
    });
  }
}
