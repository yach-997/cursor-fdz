import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUserContext } from '../interfaces';

/** 获取当前登录用户（含数据范围） */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
