import { Module } from '@nestjs/common';
import { CartService } from './cart.service.js';
import { CartController } from './cart.controller.js';

@Module({
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
