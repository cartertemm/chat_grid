import { describe, expect, it, vi } from 'vitest';
import type { GameMode } from '../state/gameState';
import { createAdminController } from './adminController';

function createDeps() {
  return {
    state: {
      mode: 'normal' as GameMode,
      nicknameInput: '',
      cursorPos: 0,
    },
    signalingSend: vi.fn(),
    announceMenuEntry: vi.fn(),
    updateStatus: vi.fn(),
    sfxUiBlip: vi.fn(),
    sfxUiCancel: vi.fn(),
    applyTextInputEdit: vi.fn(),
    setReplaceTextOnNextType: vi.fn(),
  };
}

describe('admin controller registered-user list', () => {
  it('opens the read-only list from the server-authored Shift+Z action', () => {
    const deps = createDeps();
    const controller = createAdminController(deps);
    controller.setServerAdminMenuActions([
      {
        id: 'list_users',
        label: 'List users',
        tooltip: 'List registered users.',
      },
    ]);

    controller.openAdminMenu();
    expect(deps.announceMenuEntry).toHaveBeenCalledWith('Users', 'List users');

    controller.handleAdminMenuModeInput('Enter', 'Enter');
    expect(deps.signalingSend).toHaveBeenCalledWith({ type: 'admin_users_list' });

    controller.handleAdminUsersList({
      type: 'admin_users_list',
      users: [
        {
          id: 'user-1',
          username: 'alpha',
          role: 'user',
          status: 'active',
          lastSeenAt: 1_800_000_000_000,
          online: true,
        },
      ],
    });
    expect(deps.state.mode).toBe('adminUserList');
    expect(deps.announceMenuEntry).toHaveBeenLastCalledWith('Users', 'alpha, user, active, last seen now');

    controller.handleAdminUserListModeInput('Enter', 'Enter');
    expect(deps.signalingSend).toHaveBeenCalledTimes(1);
  });
});

describe('admin controller role mutations', () => {
  it('announces the permission while navigating and only its value when toggling', () => {
    const deps = createDeps();
    const controller = createAdminController(deps);
    controller.handleAdminRolesList({
      type: 'admin_roles_list',
      roles: [{ id: 1, name: 'builder', isSystem: false, userCount: 0, permissions: ['build'] }],
      permissionKeys: ['build', 'chat'],
    });
    controller.handleAdminRoleListModeInput('Enter', 'Enter');
    controller.handleAdminRolePermissionListModeInput('Enter', 'Enter');
    expect(deps.updateStatus).toHaveBeenLastCalledWith('off');
    expect(deps.signalingSend).toHaveBeenLastCalledWith({
      type: 'admin_role_update_permissions', role: 'builder', permissions: [],
    });
    controller.handleAdminRolePermissionListModeInput('ArrowDown', 'ArrowDown');
    expect(deps.updateStatus).toHaveBeenLastCalledWith('chat: off');
    controller.handleAdminRolePermissionListModeInput('Enter', 'Enter');
    expect(deps.updateStatus).toHaveBeenLastCalledWith('on');
    expect(deps.signalingSend).toHaveBeenLastCalledWith({
      type: 'admin_role_update_permissions', role: 'builder', permissions: ['chat'],
    });
    deps.updateStatus.mockClear();
    const result = { type: 'admin_action_result', action: 'role_update_permissions' } as const;
    controller.handleAdminActionResult({ ...result, ok: true, message: 'Updated permissions for builder.' });
    expect(deps.updateStatus).not.toHaveBeenCalled();
    controller.handleAdminActionResult({ ...result, ok: false, message: 'Not authorized.' });
    expect(deps.updateStatus).toHaveBeenCalledWith('Not authorized.');
  });

  it('refreshes roles after create and delete results', () => {
    const deps = createDeps();
    const controller = createAdminController(deps);

    controller.handleAdminActionResult({
      type: 'admin_action_result',
      ok: true,
      action: 'role_create',
      message: 'Created role moderator.',
    });
    controller.handleAdminActionResult({
      type: 'admin_action_result',
      ok: true,
      action: 'role_delete',
      message: 'Deleted role moderator; reassigned 0 users to user.',
    });

    expect(deps.signalingSend).toHaveBeenNthCalledWith(1, { type: 'admin_roles_list' });
    expect(deps.signalingSend).toHaveBeenNthCalledWith(2, { type: 'admin_roles_list' });
  });
});
