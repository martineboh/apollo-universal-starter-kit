import React from 'react';

import ClientModule from '@module/module-client-react';
import { translate, TranslateFunction } from '@module/i18n-client-react';

import { Route, NavLink } from 'react-router-dom';
import { MenuItem } from '../../../packages/client/src/modules/common/components/web';
import $Module$ from './containers/$Module$';
import resources from './locales';

const NavLinkWithI18n = translate('$module$')(({ t }: { t: TranslateFunction }) => (
  <NavLink to="/$module$" className="nav-link" activeClassName="active">
    {t('$module$:navLink')}
  </NavLink>
));

export default new ClientModule({
  route: [<Route exact path="/$module$" component={$Module$} />],
  navItem: [
    <MenuItem key="/$module$">
      <NavLinkWithI18n />
    </MenuItem>
  ],
  localization: [{ ns: '$module$', resources }]
});
