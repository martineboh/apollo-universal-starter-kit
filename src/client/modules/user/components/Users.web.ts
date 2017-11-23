import { Component } from '@angular/core';

@Component({
  selector: 'users',
  template: `
    <h2>Users</h2>
    <ausk-link [to]="'/users/0'">
      <button class="btn btn-primary">Add</button>
    </ausk-link>
    <hr>
    <users-filter-view></users-filter-view>
    <hr>
    <users-list-view></users-list-view>
  `
})
export default class Users {}
