import { useAppState } from '../app/context';
import { GroupEditDialog } from './GroupEditDialog';
import { HostEditDialog } from './HostEditDialog';
import { KeyAddDialog } from './KeyAddDialog';
import { KeysDialog } from './KeysDialog';
import { KnownHostsDialog } from './KnownHostsDialog';

/** 열린 관리 대화상자 하나를 보여 준다. */
export function Dialogs() {
  const dialog = useAppState((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'host':
      return (
        <HostEditDialog
          key={dialog.profileId ?? 'new'}
          profileId={dialog.profileId}
          groupId={dialog.groupId}
        />
      );
    case 'group':
      return (
        <GroupEditDialog
          key={dialog.groupId ?? 'new'}
          groupId={dialog.groupId}
          parentId={dialog.parentId}
        />
      );
    case 'keys':
      return <KeysDialog />;
    case 'keyAdd':
      return <KeyAddDialog />;
    case 'knownHosts':
      return <KnownHostsDialog />;
  }
}
