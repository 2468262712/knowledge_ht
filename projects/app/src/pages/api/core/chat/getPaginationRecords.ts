import type { ApiRequestProps, ApiResponseType } from '@fastgpt/service/type/next';
import { NextAPI } from '@/service/middleware/entry';
import { GetChatRecordsProps } from '@/global/core/chat/api';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { transformPreviewHistories } from '@/global/core/chat/utils';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { getChatItems } from '@fastgpt/service/core/chat/controller';
import { authChatCrud } from '@/service/support/permission/auth/chat';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { AppErrEnum } from '@fastgpt/global/common/error/code/app';
import { ChatItemValueTypeEnum, ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { filterPublicNodeResponseData } from '@fastgpt/global/core/chat/utils';
import { GetChatTypeEnum } from '@/global/core/chat/constants';
import { PaginationProps, PaginationResponse } from '@fastgpt/web/common/fetch/type';
import { ChatItemType } from '@fastgpt/global/core/chat/type';
import { parsePaginationRequest } from '@fastgpt/service/common/api/pagination';

export type getPaginationRecordsQuery = {};

export type getPaginationRecordsBody = PaginationProps & GetChatRecordsProps;

export type getPaginationRecordsResponse = PaginationResponse<ChatItemType>;

async function handler(
  req: ApiRequestProps<getPaginationRecordsBody, getPaginationRecordsQuery>, // API请求参数类型
  _res: ApiResponseType<any> // API响应类型
): Promise<getPaginationRecordsResponse> {
  // 返回分页响应类型
  const { appId, chatId, loadCustomFeedbacks, type = GetChatTypeEnum.normal } = req.body; // 解构请求体参数

  // 解析分页参数（offset和pageSize）
  const { offset, pageSize } = parsePaginationRequest(req);

  // 验证基础参数
  if (!appId || !chatId) {
    return {
      list: [],
      total: 0
    };
  }

  // 并行获取应用信息和权限验证
  const [app, { responseDetail, showNodeStatus, authType }] = await Promise.all([
    MongoApp.findById(appId, 'type').lean(), // 查询应用基础信息
    authChatCrud({
      req,
      authToken: true,
      authApiKey: true,
      ...req.body
    })
  ]);

  // 应用不存在时抛出错误
  if (!app) {
    return Promise.reject(AppErrEnum.unExist);
  }

  // 判断应用类型和访问类型
  const isPlugin = app.type === AppTypeEnum.plugin; // 是否为插件应用
  const isOutLink = authType === GetChatTypeEnum.outLink; // 是否为外部链接访问类型

  // 根据聊天类型配置需要查询的字段
  const fieldMap = {
    [GetChatTypeEnum.normal]: `dataId obj value adminFeedback userBadFeedback userGoodFeedback time hideInUI ${DispatchNodeResponseKeyEnum.nodeResponse} ${loadCustomFeedbacks ? 'customFeedbacks' : ''}`, // 普通聊天类型字段
    [GetChatTypeEnum.outLink]: `dataId obj value userGoodFeedback userBadFeedback adminFeedback time hideInUI ${DispatchNodeResponseKeyEnum.nodeResponse}`, // 外部链接类型字段
    [GetChatTypeEnum.team]: `dataId obj value userGoodFeedback userBadFeedback adminFeedback time hideInUI ${DispatchNodeResponseKeyEnum.nodeResponse}` // 团队聊天类型字段
  };

  // 获取聊天记录数据
  const { total, histories } = await getChatItems({
    appId,
    chatId,
    field: fieldMap[type], // 根据类型选择字段
    offset,
    limit: pageSize
  });

  // 对敏感信息进行过滤处理（仅限外部链接访问且非插件应用）
  if (isOutLink && app.type !== AppTypeEnum.plugin) {
    histories.forEach((item) => {
      if (item.obj === ChatRoleEnum.AI) {
        // AI角色的响应需要处理
        item.responseData = filterPublicNodeResponseData({
          // 过滤公共节点响应数据
          flowResponses: item.responseData,
          responseDetail
        });

        if (showNodeStatus === false) {
          // 隐藏工具节点信息
          item.value = item.value.filter((v) => v.type !== ChatItemValueTypeEnum.tool);
        }
      }
    });
  }

  // 返回处理后的数据（插件类型直接返回原始数据，否则转换格式）
  return {
    list: isPlugin ? histories : transformPreviewHistories(histories, responseDetail),
    total
  };
}

export default NextAPI(handler); // 导出API路由处理函数
