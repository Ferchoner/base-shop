import { PartialType } from '@nestjs/mapped-types';
import { CreateCartDto } from './create-cart.dto.js';

export class UpdateCartDto extends PartialType(CreateCartDto) {}
